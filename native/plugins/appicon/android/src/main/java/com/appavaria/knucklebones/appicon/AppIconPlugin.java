package com.appavaria.knucklebones.appicon;

import android.annotation.TargetApi;
import android.content.ComponentName;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;

/**
 * Device-local launcher icon selection.
 *
 * The manifest owns the icon registry. Every selectable activity-alias carries
 * knucklebones.profileIcon metadata whose value is either "primary" or the
 * exact profile icon id. Keeping that registry out of Java means adding an
 * icon cannot silently produce a native/web list mismatch.
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {

    private static final String ICON_METADATA = "knucklebones.profileIcon";
    private static final String PRIMARY_ICON = "primary";
    private static final Object COMPONENT_STATE_LOCK = new Object();

    private static final String INVALID_ICON = "INVALID_ICON";
    private static final String INVALID_CONFIGURATION = "ICON_CONFIGURATION_INVALID";
    private static final String INVALID_STATE = "ICON_STATE_INVALID";
    private static final String UPDATE_FAILED = "ICON_UPDATE_FAILED";

    private static final class Alias {
        private final String icon;
        private final ComponentName component;
        private final boolean manifestEnabled;

        Alias(String icon, ComponentName component, boolean manifestEnabled) {
            this.icon = icon;
            this.component = component;
            this.manifestEnabled = manifestEnabled;
        }

        String icon() {
            return icon;
        }

        ComponentName component() {
            return component;
        }

        boolean manifestEnabled() {
            return manifestEnabled;
        }
    }

    private static final class IconConfigurationException extends Exception {
        IconConfigurationException(String message) {
            super(message);
        }
    }

    private static final class IconStateException extends Exception {
        IconStateException(String message) {
            super(message);
        }
    }

    @PluginMethod
    public void getState(PluginCall call) {
        synchronized (COMPONENT_STATE_LOCK) {
            try {
                Map<String, Alias> aliases = discoverAliases();
                String icon = selectedIcon(aliases);
                call.resolve(result(icon, false));
            } catch (IconConfigurationException error) {
                call.reject(error.getMessage(), INVALID_CONFIGURATION);
            } catch (IconStateException error) {
                call.reject(error.getMessage(), INVALID_STATE);
            } catch (PackageManager.NameNotFoundException | SecurityException error) {
                call.reject("Launcher icon state is unavailable", UPDATE_FAILED, error);
            } catch (RuntimeException error) {
                call.reject("Launcher icon state could not be read", UPDATE_FAILED, error);
            }
        }
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        Object rawIcon = call.getData().opt("icon");
        if (!call.getData().has("icon") || (rawIcon != JSONObject.NULL && !(rawIcon instanceof String))) {
            call.reject("icon must be a canonical string or null", INVALID_ICON);
            return;
        }
        String requested = rawIcon == JSONObject.NULL ? PRIMARY_ICON : (String) rawIcon;

        synchronized (COMPONENT_STATE_LOCK) {
            try {
                Map<String, Alias> aliases = discoverAliases();
                Alias selected = aliases.get(requested);
                if (selected == null) {
                    call.reject("Unknown launcher icon", INVALID_ICON);
                    return;
                }

                boolean changed = !isSoleSelected(aliases, selected);
                if (changed) {
                    applySelection(aliases, selected);
                }
                if (!isSoleSelected(aliases, selected)) {
                    throw new IconStateException("Launcher icon selection did not converge");
                }
                call.resolve(result(requested, changed));
            } catch (IconConfigurationException error) {
                call.reject(error.getMessage(), INVALID_CONFIGURATION);
            } catch (IconStateException error) {
                call.reject(error.getMessage(), INVALID_STATE);
            } catch (PackageManager.NameNotFoundException | SecurityException error) {
                call.reject("Launcher icon could not be changed", UPDATE_FAILED, error);
            } catch (IllegalArgumentException error) {
                call.reject("Launcher icon component update was rejected", UPDATE_FAILED, error);
            } catch (RuntimeException error) {
                call.reject("Launcher icon update failed", UPDATE_FAILED, error);
            }
        }
    }

    private JSObject result(String icon, boolean changed) {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("icon", icon);
        result.put("changed", changed);
        return result;
    }

    private Map<String, Alias> discoverAliases()
        throws PackageManager.NameNotFoundException, IconConfigurationException {
        PackageManager packageManager = getContext().getPackageManager();
        long flags = (long) PackageManager.GET_ACTIVITIES
            | PackageManager.GET_META_DATA
            | PackageManager.MATCH_DISABLED_COMPONENTS;
        PackageInfo packageInfo;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageInfo = packageManager.getPackageInfo(
                getContext().getPackageName(),
                PackageManager.PackageInfoFlags.of(flags)
            );
        } else {
            packageInfo = packageManager.getPackageInfo(getContext().getPackageName(), (int) flags);
        }

        Map<String, Alias> aliases = new LinkedHashMap<>();
        ActivityInfo[] activities = packageInfo.activities;
        if (activities != null) {
            for (ActivityInfo activity : activities) {
                Bundle metadata = activity.metaData;
                if (metadata == null || !metadata.containsKey(ICON_METADATA)) {
                    continue;
                }
                if (activity.targetActivity == null) {
                    throw new IconConfigurationException(
                        ICON_METADATA + " belongs on an activity-alias"
                    );
                }
                Object rawIcon = metadata.get(ICON_METADATA);
                if (!(rawIcon instanceof String) || ((String) rawIcon).isEmpty()) {
                    throw new IconConfigurationException(
                        ICON_METADATA + " must be a non-empty string"
                    );
                }
                String icon = (String) rawIcon;
                Alias alias = new Alias(
                    icon,
                    new ComponentName(packageInfo.packageName, activity.name),
                    activity.enabled
                );
                if (aliases.putIfAbsent(icon, alias) != null) {
                    throw new IconConfigurationException("Duplicate launcher icon id " + icon);
                }
            }
        }
        if (!aliases.containsKey(PRIMARY_ICON)) {
            throw new IconConfigurationException("Launcher aliases do not declare primary");
        }
        for (Alias alias : aliases.values()) {
            boolean shouldStartEnabled = alias.icon().equals(PRIMARY_ICON);
            if (alias.manifestEnabled() != shouldStartEnabled) {
                throw new IconConfigurationException(
                    alias.icon() + " has the wrong manifest default enabled state"
                );
            }
        }
        return aliases;
    }

    private String selectedIcon(Map<String, Alias> aliases) throws IconStateException {
        String selected = null;
        for (Alias alias : aliases.values()) {
            if (!isEnabled(alias)) {
                continue;
            }
            if (selected != null) {
                throw new IconStateException("Multiple launcher icons are enabled");
            }
            selected = alias.icon();
        }
        if (selected == null) {
            throw new IconStateException("No launcher icon is enabled");
        }
        return selected;
    }

    private boolean isSoleSelected(Map<String, Alias> aliases, Alias selected) {
        for (Alias alias : aliases.values()) {
            if (isEnabled(alias) != alias.component().equals(selected.component())) {
                return false;
            }
        }
        return true;
    }

    private boolean isEnabled(Alias alias) {
        int state = getContext().getPackageManager().getComponentEnabledSetting(alias.component());
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
            return true;
        }
        if (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT) {
            return alias.manifestEnabled();
        }
        return false;
    }

    private void applySelection(Map<String, Alias> aliases, Alias selected) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            applyAtomicSelection(aliases, selected);
            return;
        }

        // The pre-33 API cannot update components atomically. Make the desired
        // launcher reachable first, so a failed later disable can leave a
        // duplicate temporarily but can never strand the installed app.
        setComponentState(selected, selectedState(selected));
        for (Alias alias : aliases.values()) {
            if (!alias.component().equals(selected.component())) {
                setComponentState(alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
            }
        }
    }

    @TargetApi(Build.VERSION_CODES.TIRAMISU)
    private void applyAtomicSelection(Map<String, Alias> aliases, Alias selected) {
        List<PackageManager.ComponentEnabledSetting> settings = new ArrayList<>(aliases.size());
        for (Alias alias : aliases.values()) {
            int state = alias.component().equals(selected.component())
                ? selectedState(selected)
                : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
            settings.add(new PackageManager.ComponentEnabledSetting(
                alias.component(), state, PackageManager.DONT_KILL_APP
            ));
        }
        getContext().getPackageManager().setComponentEnabledSettings(settings);
    }

    private void setComponentState(Alias alias, int state) {
        getContext().getPackageManager().setComponentEnabledSetting(
            alias.component(), state, PackageManager.DONT_KILL_APP
        );
    }

    private int selectedState(Alias selected) {
        return selected.icon().equals(PRIMARY_ICON)
            ? PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
            : PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }
}
