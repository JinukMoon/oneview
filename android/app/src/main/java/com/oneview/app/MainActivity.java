package com.oneview.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileBridge.class);
        super.onCreate(savedInstanceState);
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
            try {
                PluginHandle handle = getBridge().getPlugin("FileBridge");
                if (handle != null && handle.getInstance() instanceof FileBridge) {
                    ((FileBridge) handle.getInstance()).handleIncomingUri(target, true);
                }
            } catch (Exception ignored) {}
        }
    }
}
