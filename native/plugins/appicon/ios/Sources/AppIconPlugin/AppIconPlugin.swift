import Capacitor
import UIKit

/// The native half of the profile-avatar -> launcher-icon seam.
///
/// The web layer owns the profile registry and sends either `primary` (the
/// default `die:5:cy` avatar) or a canonical `die-<face>-<hue>` alternate.
/// Native code deliberately owns a second, strict allow-list: an arbitrary
/// asset-catalog name must never become an input to UIApplication.
@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "AppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setIcon", returnType: CAPPluginReturnPromise)
    ]

    private static let primaryID = "primary"
    private static let profilePrimaryID = "die-5-cy"
    private static let hues = ["cy", "mg", "gold", "green", "violet", "orange", "blue"]
    private static let alternateIDs: Set<String> = {
        var result = Set<String>()
        for face in 1...6 {
            for hue in hues {
                let id = "die-\(face)-\(hue)"
                if id != profilePrimaryID {
                    result.insert(id)
                }
            }
        }
        return result
    }()

    /// UIApplication icon state is UIKit state. Keep every read on main as
    /// well as every mutation so bridge calls remain correct regardless of the
    /// queue Capacitor used to enter the plugin.
    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let application = UIApplication.shared
            guard let icon = Self.bridgeID(for: application.alternateIconName) else {
                call.reject(
                    "The current alternate icon is outside the profile icon registry",
                    "unknown-current-icon"
                )
                return
            }
            call.resolve([
                "supported": application.supportsAlternateIcons,
                "icon": icon
            ])
        }
    }

    @objc func setIcon(_ call: CAPPluginCall) {
        guard let requested = call.getString("icon"), !requested.isEmpty else {
            call.reject("A profile icon id is required", "invalid-icon")
            return
        }
        guard requested != Self.profilePrimaryID else {
            call.reject(
                "The default die:5:cy profile uses the primary app icon",
                "primary-as-alternate"
            )
            return
        }
        guard requested == Self.primaryID || Self.alternateIDs.contains(requested) else {
            call.reject("Unknown profile icon id", "invalid-icon")
            return
        }

        let desiredName: String? = requested == Self.primaryID ? nil : requested
        DispatchQueue.main.async {
            let application = UIApplication.shared
            let supported = application.supportsAlternateIcons

            // iOS presents its own alert after a real icon change. Comparing
            // first makes launch/profile reconciliation silent and idempotent.
            if application.alternateIconName == desiredName {
                call.resolve([
                    "supported": supported,
                    "icon": requested,
                    "changed": false
                ])
                return
            }
            guard supported else {
                call.reject("Alternate app icons are unavailable", "unsupported")
                return
            }

            application.setAlternateIconName(desiredName) { error in
                // Apple documents that this completion may arrive off-main.
                // Return to main before observing UIApplication again.
                DispatchQueue.main.async {
                    if let error {
                        call.reject(error.localizedDescription, "icon-change-failed", error)
                        return
                    }
                    guard application.alternateIconName == desiredName else {
                        call.reject(
                            "iOS completed the icon request without selecting it",
                            "icon-state-mismatch"
                        )
                        return
                    }
                    call.resolve([
                        "supported": true,
                        "icon": requested,
                        "changed": true
                    ])
                }
            }
        }
    }

    /// nil is not an unknown value here: it is the primary catalog, surfaced
    /// to JavaScript as the stable `primary` id. A non-nil unknown name means
    /// the binary and the registry drifted, so callers receive an error rather
    /// than a fabricated profile identity.
    private static func bridgeID(for alternateName: String?) -> String? {
        guard let alternateName else { return primaryID }
        return alternateIDs.contains(alternateName) ? alternateName : nil
    }
}
