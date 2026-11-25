package app.stillframe.android

import android.content.ContentValues
import android.graphics.Bitmap
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import java.io.ByteArrayOutputStream
import android.util.Base64

/**
 * 注入到 WebView 的 `window.AndroidBridge`。
 *
 * 契约与桌面壳保持一致（见 docs/ARCHITECTURE.md），前端 src/lib/desktop.ts 会探测这些方法。
 * 所有方法都在 JavaBridge 线程执行，涉及 UI 的一律 post 回主线程。
 * 出错时返回 "ERR: ..." 字符串，前端会当作异常抛出并在界面上提示。
 */
class Bridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun isAndroid(): Boolean = true

    @JavascriptInterface
    fun hasCapture(): Boolean = CaptureService.grabber != null

    @JavascriptInterface
    fun hasOverlay(): Boolean = PinOverlay.overlayGranted(activity)

    @JavascriptInterface
    fun requestScreenCapture() {
        activity.runOnUiThread { activity.askScreenCapture() }
    }

    @JavascriptInterface
    fun requestOverlayPermission() {
        activity.runOnUiThread { activity.requestOverlayPermission() }
    }

    /** 同步返回 PNG data URL —— 前端 nativeCaptureScreen() 直接转 canvas。 */
    @JavascriptInterface
    fun captureScreen(): String {
        val grabber = CaptureService.grabber
            ?: return "ERR: 还没有屏幕录制授权，请在系统弹窗里允许后再试"

        return try {
            val bitmap = grabber.capture() ?: return "ERR: 还没取到画面，请稍等再试"
            val bytes = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)
            "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
        } catch (error: Throwable) {
            "ERR: " + (error.message ?: "截屏失败")
        }
    }

    @JavascriptInterface
    fun pinImage(dataUrl: String) {
        activity.runOnUiThread { PinOverlay(activity).show(dataUrl) }
    }

    /** 存进相册 Pictures/Stillframe，返回 content:// 地址。 */
    @JavascriptInterface
    fun savePng(dataUrl: String, suggestedName: String): String {
        return try {
            val bitmap = PinOverlay.decode(dataUrl) ?: return "ERR: 图像解码失败"
            val name = if (suggestedName.endsWith(".png", ignoreCase = true)) suggestedName else "$suggestedName.png"
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(
                        MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/Stillframe",
                    )
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }

            val resolver = activity.contentResolver
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: return "ERR: 无法创建相册条目（低版本系统请先给存储权限）"
            resolver.openOutputStream(uri)?.use { stream ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            } ?: return "ERR: 无法写入相册"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            }
            uri.toString()
        } catch (error: Throwable) {
            "ERR: " + (error.message ?: "保存失败")
        }
    }

    /** 「隐藏当前窗口」：退到后台，避免把 Stillframe 自己拍进画面。 */
    @JavascriptInterface
    fun hideSelf() {
        activity.runOnUiThread { activity.hideSelf() }
    }
}
