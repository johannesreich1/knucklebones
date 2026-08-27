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
    private var playerIdentity: String?
    private var persistentIdentity = false
    private var revision = 0

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    /// WHY PERSISTENCE RIDES BESIDE THE STATUS AND NOT INSIDE IT.
    /// `scopedIDsArePersistent()` is not a sixth thing authentication can be.
    /// This player IS authenticated — iOS presented its banner and greeted them
    /// by name — and GameKit has merely declined to vouch for a stable
    /// identifier for them, which Screen Time's multiplayer limit routinely
    /// causes. Spelling that as a status would make every `status ==
    /// authenticated` reader in the web layer answer "no" and hand this player
    /// the "sign in to Game Center" remedy they have already performed.
    private func authState() -> [String: Any] {
        return ["status": status, "revision": revision, "persistentIdentity": persistentIdentity]
    }

    /// The REVISION tracks WHICH PLAYER this is, not what GameKit will sign for
    /// them: the web layer spends it to decide whether an account assertion is
    /// still current (session.ts's gameCenterSessionAction), and a persistence
    /// flip changes nothing about who is signed in. So a persistence-only
    /// change notifies at the SAME revision — the coordinator accepts an equal
    /// one — and an accepted assertion stays accepted.
    private func updateStatus(_ next: String, playerIdentity nextIdentity: String? = nil,
                              persistent nextPersistent: Bool = false) {
        let playerChanged = next != status || nextIdentity != playerIdentity
        guard playerChanged || nextPersistent != persistentIdentity else { return }
        status = next
        playerIdentity = nextIdentity
        persistentIdentity = nextPersistent
        if playerChanged { revision += 1 }
        notifyListeners("authStateChanged", data: authState())
    }

    /// Re-read what GameKit will vouch for right now. A Screen Time limit can
    /// be applied or lifted while the app is running and GameKit
    /// re-authenticates nobody for it, so a standing answer painted from this
    /// flag would otherwise go stale in either direction.
    private func refreshPersistence() {
        guard status == "authenticated" else { return }
        let player = GKLocalPlayer.local
        updateStatus("authenticated", playerIdentity: player.teamPlayerID,
                     persistent: player.scopedIDsArePersistent())
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
                    // Account changes can keep isAuthenticated=true. Track the
                    // scoped identity privately so the web layer's revision
                    // changes and it requests a fresh server assertion.
                    self.updateStatus("authenticated", playerIdentity: player.teamPlayerID,
                                      persistent: player.scopedIDsArePersistent())
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
            self.refreshPersistence()
            call.resolve(self.authState())
        }
    }

    @objc func getAuthState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.installHandler()
            self.refreshPersistence()
            call.resolve(self.authState())
        }
    }

    @objc func fetchIdentityProof(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.installHandler()
            let player = GKLocalPlayer.local
            // EVERY REFUSAL CARRIES A STABLE CODE. The message is a human
            // diagnostic — Apple's is even localized — so the web layer reads
            // the code and shows the player copy matched to what they can
            // actually DO about it (src/native/game-center.ts). Collapsing
            // these into one rejection is how "please try again" ended up
            // being the app's answer to a device that needed a Settings trip.
            guard player.isAuthenticated else {
                call.reject("not signed in to Game Center", "not-authenticated")
                return
            }
            // The refusal below and the standing answer the profile paints are
            // ONE reading of GameKit, published before it is acted on so the
            // two can never disagree about the same device.
            self.refreshPersistence()
            guard player.scopedIDsArePersistent() else {
                call.reject("Game Center identifiers are not persistent", "identifiers-not-persistent")
                return
            }
            player.fetchItems(forIdentityVerificationSignature: { url, signature, salt, timestamp, error in
                if let error = error {
                    call.reject(error.localizedDescription, "signature-unavailable", error)
                    return
                }
                guard let url = url, let signature = signature, let salt = salt else {
                    call.reject("Game Center returned no signature", "signature-unavailable")
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
