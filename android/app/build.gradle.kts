plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.stillframe.android"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.stillframe.android"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // 前端产物直接在 assets/www 下，不打进 res，避免被压缩影响 WebView 读取。
    androidResources {
        noCompress += listOf("html", "js", "css", "png", "webp", "svg")
    }
}

dependencies {
    // WebViewAssetLoader：用 https://appassets.androidplatform.net 提供 assets，
    // 避免 file:// 协议下 IndexedDB / CORS / 相对路径的各种坑。
    implementation("androidx.webkit:webkit:1.11.0")
}
