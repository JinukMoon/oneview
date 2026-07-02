import Foundation
import UIKit
import Capacitor
import UniformTypeIdentifiers

/// iOS port of android/.../FileBridge.java — same 5 methods + "incomingFile" event,
/// so www/app.js runs unchanged on both platforms.
@objc(FileBridgePlugin)
public class FileBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FileBridgePlugin"
    public let jsName = "FileBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getLaunchFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCurrent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternally", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFile", returnType: CAPPluginReturnPromise)
    ]

    static weak var shared: FileBridgePlugin?
    /// openURL can arrive before the bridge registers this plugin (cold start) — stash until load().
    static var pendingURL: URL?

    private var lastCachedFile: URL?
    private var lastName: String?
    private var lastError: String?
    /// Set when the file already reached JS via the "incomingFile" event, so a later
    /// getLaunchFile() doesn't open the same document a second time.
    private var deliveredViaEvent = false
    private var pickCall: CAPPluginCall?
    /// Must be retained while the open-in menu is on screen or it dismisses itself.
    private var docInteraction: UIDocumentInteractionController?

    override public func load() {
        FileBridgePlugin.shared = self
        if let pending = FileBridgePlugin.pendingURL {
            FileBridgePlugin.pendingURL = nil
            DispatchQueue.global(qos: .userInitiated).async { self.handleIncomingURL(pending) }
        }
    }

    /// Called from AppDelegate when an incoming "Open in OneView" file URL arrives.
    public func handleIncomingURL(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let name = url.lastPathComponent
            let cached = try copyToCache(url, name: name)
            lastCachedFile = cached
            lastName = name
            lastError = nil
            // Cold start: JS hasn't attached listeners yet, so getLaunchFile() delivers
            // (mirrors Android, where only warm-start onNewIntent emits the event).
            if hasListeners("incomingFile") {
                deliveredViaEvent = true
                notifyListeners("incomingFile", data: ["name": name, "path": cached.path])
            } else {
                deliveredViaEvent = false
            }
        } catch {
            lastError = String(describing: error)
        }
    }

    @objc func getLaunchFile(_ call: CAPPluginCall) {
        var ret = JSObject()
        if let file = lastCachedFile, !deliveredViaEvent {
            ret["name"] = lastName ?? file.lastPathComponent
            ret["path"] = file.path
        } else {
            ret["none"] = true
            if lastCachedFile == nil {
                ret["error"] = lastError ?? "no data uri"
            }
        }
        call.resolve(ret)
    }

    @objc func setCurrent(_ call: CAPPluginCall) {
        // Sync the native "current file" with whatever JS is showing (e.g. a recent-files reopen),
        // so share/openExternally act on the right file.
        var ret = JSObject()
        if let path = call.getString("path"), FileManager.default.fileExists(atPath: path) {
            let file = URL(fileURLWithPath: path)
            lastCachedFile = file
            let name = call.getString("name")
            lastName = (name?.isEmpty == false) ? name : file.lastPathComponent
            ret["exists"] = true
        } else {
            // path gone (e.g. evicted cache) — clear so we never share a stale, wrong file
            lastCachedFile = nil
            lastName = nil
            ret["exists"] = false
        }
        call.resolve(ret)
    }

    @objc func openExternally(_ call: CAPPluginCall) {
        guard let file = lastCachedFile else {
            call.reject("no file to forward")
            return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("no view controller")
                return
            }
            let dic = UIDocumentInteractionController(url: file)
            self.docInteraction = dic
            let rect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            if dic.presentOpenInMenu(from: rect, in: vc.view, animated: true) {
                call.resolve()
            } else {
                self.docInteraction = nil
                call.reject("no app can open this file")
            }
        }
    }

    @objc func shareFile(_ call: CAPPluginCall) {
        guard let file = lastCachedFile else {
            call.reject("no file to share")
            return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("no view controller")
                return
            }
            let activity = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            if let pop = activity.popoverPresentationController {
                // iPad: UIActivityViewController crashes without an anchor
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
                pop.permittedArrowDirections = []
            }
            vc.present(activity, animated: true)
            call.resolve()
        }
    }

    @objc func pickFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("no view controller")
                return
            }
            self.pickCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            vc.present(picker, animated: true)
        }
    }

    // MARK: - helpers

    private func copyToCache(_ src: URL, name: String) throws -> URL {
        let fm = FileManager.default
        let caches = try fm.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let incoming = caches.appendingPathComponent("incoming", isDirectory: true)
        // unique per-copy subdir → no collision when two files share a display name
        let dir = incoming.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        // keep only URL-safe chars (letters incl. Korean, digits, . _ -) so convertFileSrc/fetch works
        var safe = name.replacingOccurrences(of: "[^\\p{L}\\p{N}._-]", with: "_", options: .regularExpression)
        if safe.isEmpty || safe == "." || safe == ".." { safe = "document" }
        let dst = dir.appendingPathComponent(safe)
        if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
        try fm.copyItem(at: src, to: dst)
        pruneIncoming(incoming, keep: 20)
        return dst
    }

    /// keep only the newest `keep` cached copies so they don't pile up forever
    private func pruneIncoming(_ incoming: URL, keep: Int) {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: incoming,
            includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey]) else { return }
        let dirs = entries.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
        guard dirs.count > keep else { return }
        let sorted = dirs.sorted { a, b in
            let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return da > db
        }
        for stale in sorted.dropFirst(keep) {
            try? fm.removeItem(at: stale)
        }
    }
}

extension FileBridgePlugin: UIDocumentPickerDelegate {
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickCall else { return }
        pickCall = nil
        guard let url = urls.first else {
            var ret = JSObject()
            ret["canceled"] = true
            call.resolve(ret)
            return
        }
        // copy off the main thread to avoid blocking on large files
        DispatchQueue.global(qos: .userInitiated).async {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let name = url.lastPathComponent
                let cached = try self.copyToCache(url, name: name)
                self.lastCachedFile = cached
                self.lastName = name
                var ret = JSObject()
                ret["name"] = name
                ret["path"] = cached.path
                call.resolve(ret)
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pickCall else { return }
        pickCall = nil
        var ret = JSObject()
        ret["canceled"] = true
        call.resolve(ret)
    }
}
