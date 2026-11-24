package com.roohu.clipforge;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Optional Gemini (Google AI) helper over the official REST API. Sends ONLY the text it is given (clip transcripts),
 * never video or audio. The key lives in SecureStore and goes in the x-goog-api-key header, never in a URL.
 * Retries with backoff (Net.retry) and caches answers on the phone so the same request is never sent twice.
 */
final class GeminiClient {
    private static final String BASE = "https://generativelanguage.googleapis.com/v1beta/";
    private static final String PREFS = "gemini";
    private static final long MODEL_TTL_MS = 24L * 3600 * 1000;
    private static final int MAX_INPUT_CHARS = 60000;

    /** Asks for structured JSON that matches `schema`; returns the model's JSON text. Call off the UI thread. */
    static String generateJson(Context ctx, String key, String system, String user, JSONObject schema) throws Exception {
        return generateJson(ctx, key, system, user, schema, null);
    }

    /** Same, with optional JPEG frames (base64) the model can look at. */
    static String generateJson(Context ctx, String key, String system, String user, JSONObject schema, JSONArray images) throws Exception {
        if (user.length() > MAX_INPUT_CHARS) user = user.substring(0, MAX_INPUT_CHARS);
        final String model = pickModel(ctx, key);
        JSONObject body = new JSONObject();
        body.put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", system))));
        body.put("contents", new JSONArray().put(new JSONObject().put("role", "user")
                .put("parts", userParts(user, images))));
        body.put("generationConfig", new JSONObject().put("temperature", 0.4).put("maxOutputTokens", 4096)
                .put("responseMimeType", "application/json").put("responseSchema", schema));
        final String payload = body.toString();

        File cf = cacheFile(ctx, model + "|" + payload);
        if (cf.isFile()) {
            try { return new String(java.nio.file.Files.readAllBytes(cf.toPath()), StandardCharsets.UTF_8); } catch (Exception ignored) { cf.delete(); }
        }
        final String url = BASE + "models/" + model + ":generateContent";
        String raw = Net.retry(() -> http("POST", url, key, payload), 4);
        JSONObject j = new JSONObject(raw);
        JSONArray cands = j.optJSONArray("candidates");
        if (cands == null || cands.length() == 0) {
            JSONObject fb = j.optJSONObject("promptFeedback");
            String why = fb == null ? "" : fb.optString("blockReason", "");
            throw new IOException(why.isEmpty() ? "Gemini returned no answer." : "Gemini declined this request (" + why + ").");
        }
        JSONArray parts = cands.getJSONObject(0).optJSONObject("content") == null ? null
                : cands.getJSONObject(0).getJSONObject("content").optJSONArray("parts");
        StringBuilder text = new StringBuilder();
        if (parts != null) for (int i = 0; i < parts.length(); i++) text.append(parts.getJSONObject(i).optString("text", ""));
        if (text.length() == 0) throw new IOException("Gemini returned an empty answer.");
        try {
            File tmp = new File(cf.getPath() + ".tmp");
            java.nio.file.Files.write(tmp.toPath(), text.toString().getBytes(StandardCharsets.UTF_8));
            if (!tmp.renameTo(cf)) tmp.delete();
            File[] all = cf.getParentFile().listFiles();
            if (all != null && all.length > 40) {
                java.util.Arrays.sort(all, (x, y) -> Long.compare(x.lastModified(), y.lastModified()));
                for (int i = 0; i < all.length - 40; i++) all[i].delete();
            }
        } catch (Exception ignored) { }
        return text.toString();
    }

    private static JSONArray userParts(String user, JSONArray images) throws Exception {
        JSONArray parts = new JSONArray();
        if (images != null) for (int i = 0; i < images.length(); i++) {
            parts.put(new JSONObject().put("inlineData", new JSONObject().put("mimeType", "image/jpeg").put("data", images.getString(i))));
        }
        parts.put(new JSONObject().put("text", user));
        return parts;
    }

    /** Lists the models this key can use and picks the newest stable "flash" one, so no model name is hardcoded. */
    private static synchronized String pickModel(Context ctx, String key) throws Exception {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String saved = sp.getString("model", null);
        if (saved != null && System.currentTimeMillis() - sp.getLong("at", 0) < MODEL_TTL_MS) return saved;
        String best = "gemini-flash-latest";
        try {
            String raw = Net.retry(() -> http("GET", BASE + "models?pageSize=200", key, null), 3);
            JSONArray ms = new JSONObject(raw).optJSONArray("models");
            double bestScore = -1;
            Pattern ver = Pattern.compile("gemini-(\\d+(?:\\.\\d+)?)");
            if (ms != null) for (int i = 0; i < ms.length(); i++) {
                JSONObject m = ms.getJSONObject(i);
                String name = m.optString("name", "").replace("models/", "");
                JSONArray methods = m.optJSONArray("supportedGenerationMethods");
                boolean ok = false;
                if (methods != null) for (int k = 0; k < methods.length(); k++) if ("generateContent".equals(methods.optString(k))) ok = true;
                if (!ok || !name.startsWith("gemini-") || !name.contains("flash")) continue;
                if (name.matches(".*(lite|image|tts|live|audio|embedding|thinking|exp|robotics|computer).*")) continue;
                Matcher mt = ver.matcher(name);
                double score = mt.find() ? Double.parseDouble(mt.group(1)) * 1000 : 1;
                if (name.contains("preview")) score -= 1;
                if (name.contains("latest")) score += 0.5;
                if (score > bestScore) { bestScore = score; best = name; }
            }
        } catch (Exception e) {
            if (e instanceof Net.HttpFail && ((Net.HttpFail) e).code < 500 && ((Net.HttpFail) e).code != 429) throw e;   // bad key etc.
        }
        sp.edit().putString("model", best).putLong("at", System.currentTimeMillis()).apply();
        return best;
    }

    private static String http(String method, String url, String key, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(20000);
        c.setReadTimeout(90000);
        c.setRequestProperty("x-goog-api-key", key);
        c.setRequestProperty("Accept", "application/json");
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = c.getResponseCode();
        String resp = read(code >= 400 ? c.getErrorStream() : c.getInputStream());
        if (code >= 400) {
            long ra = 0;
            try { String h = c.getHeaderField("Retry-After"); if (h != null) ra = (long) (Double.parseDouble(h.trim()) * 1000); } catch (Exception ignored) { }
            String msg;
            try { msg = new JSONObject(resp).getJSONObject("error").optString("message", ""); } catch (Exception e) { msg = ""; }
            if (code == 401 || code == 403) throw new Net.HttpFail(code, "The Gemini key was not accepted. Check it in Settings.", 0);
            if (code == 429) throw new Net.HttpFail(code, "The free Gemini limit is used up for now. Try again in a few minutes.", ra);
            throw new Net.HttpFail(code, "Gemini request failed (" + code + ")" + (msg.isEmpty() ? "." : ": " + msg.substring(0, Math.min(160, msg.length()))), ra);
        }
        return resp;
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }

    private static File cacheFile(Context ctx, String material) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest(material.getBytes(StandardCharsets.UTF_8))) sb.append(String.format("%02x", b));
        File dir = new File(ctx.getCacheDir(), "gemini");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, sb + ".json");
    }
}
