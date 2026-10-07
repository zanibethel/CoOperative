@file:Suppress("DEPRECATION")

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.cooperative.localai"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.cooperative.localai"
        minSdk = 26
        targetSdk = 36
        versionCode = 6
        versionName = "0.5.0-alpha06"

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

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("com.google.ai.edge.litertlm:litertlm-android:0.17.0")
}
