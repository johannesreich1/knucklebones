package com.appavaria.knucklebones;

import android.os.Bundle;
import com.appavaria.knucklebones.appicon.AppIconPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppIconPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
