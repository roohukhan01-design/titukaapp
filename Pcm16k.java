package com.roohu.clipforge;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** Decodes a clip's audio to 16 kHz mono PCM16 once, so every speech engine can reuse it. */
final class Pcm16k {
    final byte[] data;
    final double base;   // source-video time (s) of the first sample
    private Pcm16k(byte[] d, double b) { data = d; base = b; }

    static Pcm16k decode(Context ctx, Uri uri, double startS, double endS, Transcriber.Prog prog) throws Exception {
        MediaExtractor ex = new MediaExtractor();
        MediaCodec dec = null;
        ByteArrayOutputStream out = new ByteArrayOutputStream(1 << 20);
        double base = -1;
        try {
            ex.setDataSource(ctx, uri, null);
            int ai = -1;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                String mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { ai = i; break; }
            }
            if (ai < 0) throw new IOException("This video has no audio track to caption.");
            ex.selectTrack(ai);
            MediaFormat f = ex.getTrackFormat(ai);
            long startUs = (long) (startS * 1e6), endUs = (long) (endS * 1e6);
            ex.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
            int sr = f.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int ch = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            dec = MediaCodec.createDecoderByType(f.getString(MediaFormat.KEY_MIME));
            dec.configure(f, null, null, 0);
            dec.start();
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inDone = false, outDone = false;
            double step = sr / 16000.0, nextOut = step, acc = 0;
            long idx = 0; int cnt = 0, lastPct = -1;
            while (!outDone) {
                if (!inDone) {
                    int ii = dec.dequeueInputBuffer(10000);
                    if (ii >= 0) {
                        ByteBuffer ib = dec.getInputBuffer(ii);
                        int n = ex.readSampleData(ib, 0);
                        long st = ex.getSampleTime();
                        if (n < 0 || st > endUs) {
                            dec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inDone = true;
                        } else {
                            dec.queueInputBuffer(ii, 0, n, st, 0);
                            ex.advance();
                        }
                    }
                }
                int oi = dec.dequeueOutputBuffer(info, 10000);
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = dec.getOutputFormat();
                    if (of.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sr = of.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) ch = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    step = sr / 16000.0;
                } else if (oi >= 0) {
                    if (info.size > 0) {
                        if (base < 0) base = info.presentationTimeUs / 1e6;
                        ByteBuffer ob = dec.getOutputBuffer(oi);
                        ob.position(info.offset);
                        ob.limit(info.offset + info.size);
                        short[] pcm = new short[info.size / 2];
                        ob.order(ByteOrder.nativeOrder()).asShortBuffer().get(pcm);
                        for (int p = 0; p + ch <= pcm.length; p += ch) {
                            int s = 0;
                            for (int c = 0; c < ch; c++) s += pcm[p + c];
                            acc += s / (double) ch; cnt++; idx++;
                            if (idx >= nextOut) {
                                short o = (short) (acc / Math.max(1, cnt));
                                acc = 0; cnt = 0; nextOut += step;
                                out.write(o & 0xFF);
                                out.write((o >> 8) & 0xFF);
                            }
                        }
                        int pct = (int) Math.max(0, Math.min(99, (info.presentationTimeUs - startUs) * 100.0 / Math.max(1, endUs - startUs)));
                        if (pct != lastPct) { lastPct = pct; prog.on(pct); }
                    }
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outDone = true;
                    dec.releaseOutputBuffer(oi, false);
                }
            }
        } finally {
            try { if (dec != null) { dec.stop(); dec.release(); } } catch (Exception ignored) { }
            try { ex.release(); } catch (Exception ignored) { }
        }
        return new Pcm16k(out.toByteArray(), Math.max(0, base));
    }
}
