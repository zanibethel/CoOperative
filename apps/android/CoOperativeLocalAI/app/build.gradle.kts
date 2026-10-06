plugins {
    id("com.android.application")
}

android {
    namespace = "app.cooperative.localai"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.cooperative.localai"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-alpha01"

        buildConfigField(
            "String",
            "COOPERATIVE_BASE_URL",
            "\"https://co-operative-mu.vercel.app\"",
        )
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
