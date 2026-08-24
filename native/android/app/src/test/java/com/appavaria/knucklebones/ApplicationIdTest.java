package com.appavaria.knucklebones;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ApplicationIdTest {

    @Test
    public void generatedApplicationIdMatchesReleaseContract() {
        assertEquals("com.appavaria.knucklebones", BuildConfig.APPLICATION_ID);
    }
}
