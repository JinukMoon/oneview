package com.oneview.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileBridge.class);
        // Cold start without an incoming file → clear leftover cached copies from previous sessions.
        Intent i = getIntent();
        boolean hasFile = i != null && (i.getData() != null
                || (Intent.ACTION_SEND.equals(i.getAction()) && i.hasExtra(Intent.EXTRA_STREAM)));
        if (!hasFile) {
            try {
                java.io.File incoming = new java.io.File(getCacheDir(), "incoming");
                java.io.File[] dirs = incoming.listFiles();
                if (dirs != null) for (java.io.File d : dirs) deleteRecursive(d);
            } catch (Exception ignored) {}
        }
        super.onCreate(savedInstanceState);
    }

    private static void deleteRecursive(java.io.File f) {
        java.io.File[] kids = f.listFiles();
        if (kids != null) for (java.io.File k : kids) deleteRecursive(k);
        f.delete();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent == null) return;
        android.net.Uri target = intent.getData();
        if (target == null && Intent.ACTION_SEND.equals(intent.getAction())) {
            try { target = intent.getParcelableExtra(Intent.EXTRA_STREAM); } catch (Exception ignored) {}
        }
        if (target != null) {
            final android.net.Uri t = target;
            // copy off the main thread to avoid ANR on large files
            new Thread(() -> {
                try {
                    PluginHandle handle = getBridge().getPlugin("FileBridge");
                    if (handle != null && handle.getInstance() instanceof FileBridge) {
                        ((FileBridge) handle.getInstance()).handleIncomingUri(t, true);
                    }
                } catch (Exception ignored) {}
            }).start();
        }
    }
}
