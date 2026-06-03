package com.oneview.app;

import android.content.ComponentName;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "FileBridge")
public class FileBridge extends Plugin {

    private File lastCachedFile = null;
    private String lastName = null;
    private String lastError = null;

    /** Called from MainActivity when an incoming VIEW/SEND intent carries a file. */
    public void handleIncomingUri(Uri uri, boolean emit) {
        if (uri == null) { lastError = "uri is null"; return; }
        try {
            String name = queryName(uri);
            File cached = copyToCache(uri, name);
            lastCachedFile = cached;
            lastName = name;
            lastError = null;
            if (emit) {
                JSObject ret = new JSObject();
                ret.put("name", name);
                ret.put("path", cached.getAbsolutePath());
                notifyListeners("incomingFile", ret);
            }
        } catch (Exception e) {
            lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    @PluginMethod
    public void getLaunchFile(PluginCall call) {
        if (lastCachedFile == null && getActivity() != null) {
            Intent intent = getActivity().getIntent();
            String act = intent != null ? intent.getAction() : "null-intent";
            Uri data = intent != null ? intent.getData() : null;
            Uri stream = null;
            if (intent != null) {
                try { stream = intent.getParcelableExtra(Intent.EXTRA_STREAM); } catch (Exception ignored) {}
            }
            Uri target = data != null ? data : stream;
            if (target != null) {
                handleIncomingUri(target, false);
            } else {
                lastError = "no data uri (action=" + act + ")";
            }
        }
        JSObject ret = new JSObject();
        if (lastCachedFile != null) {
            ret.put("name", lastName);
            ret.put("path", lastCachedFile.getAbsolutePath());
        } else {
            ret.put("none", true);
            ret.put("error", lastError);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openExternally(PluginCall call) {
        if (lastCachedFile == null) {
            call.reject("no file to forward");
            return;
        }
        try {
            Uri content = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    lastCachedFile);
            String mime = guessMime(lastName);
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(content, mime);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(view, "다른 앱으로 열기");
            // Don't offer ourselves in the chooser (we already couldn't render it).
            chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS,
                    new ComponentName[]{ new ComponentName(getContext(), MainActivity.class) });
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "forward failed");
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        if (lastCachedFile == null) {
            call.reject("no file to share");
            return;
        }
        try {
            Uri content = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    lastCachedFile);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(guessMime(lastName));
            send.putExtra(Intent.EXTRA_STREAM, content);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "공유");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "share failed");
        }
    }

    @PluginMethod
    public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "pickFileResult");
    }

    @ActivityCallback
    private void pickFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("canceled", true);
            call.resolve(ret);
            return;
        }
        try {
            Uri uri = data.getData();
            String name = queryName(uri);
            File cached = copyToCache(uri, name);
            lastCachedFile = cached;
            lastName = name;
            JSObject ret = new JSObject();
            ret.put("name", name);
            ret.put("path", cached.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "pick failed");
        }
    }

    // ---- helpers ----

    private String queryName(Uri uri) {
        String name = null;
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) name = c.getString(idx);
            }
        } catch (Exception ignored) {}
        if (name == null) {
            name = uri.getLastPathSegment();
            if (name != null && name.contains("/")) {
                name = name.substring(name.lastIndexOf('/') + 1);
            }
        }
        if (name == null || name.isEmpty()) name = "document";
        return name;
    }

    private File copyToCache(Uri uri, String name) throws Exception {
        File dir = new File(getContext().getCacheDir(), "incoming");
        if (!dir.exists()) dir.mkdirs();
        String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        File out = new File(dir, safe);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new Exception("cannot open input stream");
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) != -1) os.write(buf, 0, r);
        }
        return out;
    }

    private String guessMime(String name) {
        String ext = "";
        int dot = name == null ? -1 : name.lastIndexOf('.');
        if (dot >= 0) ext = name.substring(dot + 1).toLowerCase();
        switch (ext) {
            case "pdf":  return "application/pdf";
            case "doc":  return "application/msword";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xls":  return "application/vnd.ms-excel";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "ppt":  return "application/vnd.ms-powerpoint";
            case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            case "hwp":  return "application/x-hwp";
            case "hwpx": return "application/hwp+zip";
            default:     return "*/*";
        }
    }
}
