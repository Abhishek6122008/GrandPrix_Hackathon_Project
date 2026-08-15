plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.crowdflow.crowdflow_walker"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Matches the backend's Maven groupId. Fixed once and not to be changed: the
        // applicationId is the installed app's identity, so editing it makes every phone
        // treat the next build as a different app rather than an upgrade.
        applicationId = "com.crowdflow.crowdflow_walker"
        // minSdk comes from geolocator's floor via the Flutter plugin, not from a number
        // chosen here. Version code and name track pubspec.yaml.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // Debug keys, deliberately, for as long as this app is sideloaded onto demo
            // phones rather than distributed. The consequence to know: the debug keystore is
            // generated per machine, so an APK built here and an APK built elsewhere are
            // signed by different keys and Android will refuse to install one over the other.
            //
            // Before this goes anywhere real it needs a keystore, a key.properties read from
            // outside the repo, and a signingConfig here. android/.gitignore already excludes
            // key.properties and *.jks so that step cannot accidentally commit the key.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
