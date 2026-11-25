-keep class app.stillframe.android.Bridge { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
