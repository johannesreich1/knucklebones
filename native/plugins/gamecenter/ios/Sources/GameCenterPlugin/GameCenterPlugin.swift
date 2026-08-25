import Foundation
import Capacitor
import GameKit

/// Game Center → a signature our server can check (supabase/functions/gc-auth).
///
/// This plugin deliberately does NOT decide anything. It authenticates the local
/// player, asks Apple to sign that identity, and hands the raw material to the
/// web layer — because the only place a Game Center identity may be turned into
/// an account is the Edge Function, where the signature is verified against
/// Apple's certificate. A player id on its own proves nothing.
///
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAuthState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchIdentityProof", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    private var initialized = false
    private var status = "unavailable"
    private var revision = 0

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    private func authState() -> [String: Any] {
        return ["status": status, "revision": revision]
    }

    private func updateStatus(_ next: String) {
        guard next != status else { return }
        status = next
        revision += 1
        notifyListeners("authStateChanged", data: authState())
    }

    private func installHandler() {
        guard !initialized else { return }
        initialized = true
        updateStatus("authenticating")
        let player = GKLocalPlayer.local
        player.authenticateHandler = { viewController, error in
            DispatchQueue.main.async {
                if let viewController = viewController {
                    self.bridge?.viewController?.present(viewController, animated: true)
                    return
                }
                if player.isAuthenticated {
                    self.updateStatus("authenticated")
                } else if let gameError = error as? GKError, gameError.code == .cancelled {
                    self.updateStatus("declined")
                } else if error != nil {
                    self.updateStatus("failed")
                } else {
                    self.updateStatus("signed-out")
                }
            }
        }
    }

    @objc func initialize(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.installHandler()
            call.resolve(self.authState())
        }
    }

    @objc func getAuthState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.installHandler()
            call.resolve(self.authState())
        }
    }

    @objc func fetchIdentityProof(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.installHandler()
            let player = GKLocalPlayer.local
            guard player.isAuthenticated else {
                call.reject("not signed in to Game Center")
                return
            }
            guard player.scopedIDsArePersistent() else {
                call.reject("Game Center identifiers are not persistent")
                return
            }
            player.fetchItems(forIdentityVerificationSignature: { url, signature, salt, timestamp, error in
                if let error = error { call.reject(error.localizedDescription); return }
                guard let url = url, let signature = signature, let salt = salt else {
                    call.reject("Game Center returned no signature")
                    return
                }
                call.resolve([
                    "publicKeyUrl": url.absoluteString,
                    "signature": signature.base64EncodedString(),
                    "salt": salt.base64EncodedString(),
                    "timestamp": String(timestamp),
                    "teamPlayerID": player.teamPlayerID
                ])
            })
        }
    }

    // Compatibility with the already-synced web payload. New code initializes
    // at launch and asks for a proof separately.
    @objc func signIn(_ call: CAPPluginCall) {
        fetchIdentityProof(call)
    }
}
