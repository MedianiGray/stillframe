package app.stillframe.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper

/**
 * MediaProjection + ImageReader 抓帧。
 *
 * 关键点：ImageReader 拿到的 Image 有 rowStride padding（行尾会多出几个像素），
 * 直接 copyPixelsFromBuffer 到 width×height 的 Bitmap 会错行，所以先按 stride 宽度建图再裁。
 */
class ScreenGrabber(
    private val context: Context,
    private val projection: MediaProjection,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val lock = Any()

    private var reader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var width = 0
    private var height = 0

    @Volatile
    private var released = false

    private val stopCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            release()
        }
    }

    init {
        // Android 14 要求每次授权后都注册回调，否则 getMediaProjection 之后的取帧会抛异常。
        projection.registerCallback(stopCallback, handler)
    }

    fun ensureDisplay(): Boolean = synchronized(lock) {
        if (released) return false
        if (reader != null) return true

        val metrics = context.resources.displayMetrics
        width = metrics.widthPixels
        height = metrics.heightPixels

        val imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
        reader = imageReader
        virtualDisplay = projection.createVirtualDisplay(
            "stillframe",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.surface,
            null,
            handler,
        )
        true
    }

    /** 取最新一帧，编码交给调用方（Bridge 里转 PNG base64）。 */
    fun capture(): Bitmap? = synchronized(lock) {
        if (released) return null
        if (reader == null && !ensureDisplay()) return null

        var image: Image? = null
        var tries = 0
        while (image == null && tries < 8) {
            image = reader?.acquireLatestImage()
            if (image == null) {
                // 首帧还没到；调用来自 JavaBridge 线程，短暂阻塞可接受。
                Thread.sleep(50)
            }
            tries += 1
        }

        val frame = image ?: return null
        try {
            return toBitmap(frame)
        } finally {
            frame.close()
        }
    }

    private fun toBitmap(image: Image): Bitmap {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width
        val rawWidth = width + rowPadding / pixelStride

        val full = Bitmap.createBitmap(rawWidth, height, Bitmap.Config.ARGB_8888)
        full.copyPixelsFromBuffer(buffer)
        if (rawWidth == width) return full

        val cropped = Bitmap.createBitmap(full, 0, 0, width, height)
        full.recycle()
        return cropped
    }

    fun release() {
        synchronized(lock) {
            if (released) return
            released = true
            virtualDisplay?.release()
            virtualDisplay = null
            reader?.close()
            reader = null
            runCatching { projection.unregisterCallback(stopCallback) }
            runCatching { projection.stop() }
        }
    }
}
