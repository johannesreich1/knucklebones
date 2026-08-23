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
/// Both player ids travel: Apple's own documentation disagrees with its Arcade
/// guidance about which one `fetchItems` signs, so the server tries each and
/// reports which verified.
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    /// The bridge itself is the capability signal. Authentication state must
    /// not hide the button on a fresh device: signIn() owns installing Apple's
    /// authenticateHandler and presenting its sheet when required.
    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let player = GKLocalPlayer.local

            // authenticateHandler can fire more than once (and again later, on
            // its own), so every path through it is guarded: a CAPPluginCall
            // may only be settled once.
            var settled = false
            let finish: (_ ok: [String: Any]?, _ err: String?) -> Void = { ok, err in
                guard !settled else { return }
                settled = true
                if let ok = ok { call.resolve(ok) } else { call.reject(err ?? "Game Center sign-in failed") }
            }

            let sign = {
                player.fetchItems(forIdentityVerificationSignature: { url, signature, salt, timestamp, error in
                    if let error = error { finish(nil, error.localizedDescription); return }
                    guard let url = url, let signature = signature, let salt = salt else {
                        finish(nil, "Game Center returned no signature"); return
                    }
                    finish([
                        "publicKeyUrl": url.absoluteString,
                        "signature": signature.base64EncodedString(),
                        "salt": salt.base64EncodedString(),
                        // milliseconds, and far past 2^53 is not a risk here, but
                        // JSON numbers are lossy by nature — send it as a string
                        "timestamp": String(timestamp),
                        "gamePlayerID": player.gamePlayerID,
                        "teamPlayerID": player.teamPlayerID,
                        "displayName": player.displayName
                    ], nil)
                })
            }

            if player.isAuthenticated { sign(); return }

            player.authenticateHandler = { viewController, error in
                if let viewController = viewController {
                    // iOS wants to show its own sign-in sheet first
                    self.bridge?.viewController?.present(viewController, animated: true)
                    return
                }
                if let error = error { finish(nil, error.localizedDescription); return }
                guard player.isAuthenticated else { finish(nil, "not signed in to Game Center"); return }
                sign()
            }
        }
    }
}
