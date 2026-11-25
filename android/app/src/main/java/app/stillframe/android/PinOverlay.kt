package app.stillframe.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.ImageView

/**
 * 贴图悬浮窗：对应 QQ 截图里的「贴图」。
 * 需要 SYSTEM_ALERT_WINDOW 权限，没授权就先去设置页。
 * 拖动移动，双击关闭。
 */
class PinOverlay(private val activity: Activity) {

    companion object {
        fun decode(dataUrl: String): Bitmap? = try {
            val comma = dataUrl.indexOf(',')
            val payload = if (comma >= 0) dataUrl.substring(comma + 1) else dataUrl
            val bytes = Base64.decode(payload, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (error: Throwable) {
            null
        }

        fun overlayGranted(context: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
    }

    fun show(dataUrl: String) {
        if (!overlayGranted(activity)) {
            activity.requestOverlayPermission()
            return
        }

        val bitmap = decode(dataUrl) ?: return
        val manager = activity.getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val view = ImageView(activity).apply {
            setImageBitmap(bitmap)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.TRANSPARENT)
            contentDescription = "Stillframe 贴图"
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 48
            y = 220
        }

        var downRawX = 0f
        var downRawY = 0f
        var startX = 0
        var startY = 0

        view.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = params.x
                    startY = params.y
                    false
                }

                MotionEvent.ACTION_MOVE -> {
                    params.x = startX + (event.rawX - downRawX).toInt()
                    params.y = startY + (event.rawY - downRawY).toInt()
                    runCatching { manager.updateViewLayout(v, params) }
                    true
                }

                else -> false
            }
        }

        var lastTapAt = 0L
        view.setOnClickListener {
            val now = SystemClock.uptimeMillis()
            if (now - lastTapAt <= 400) {
                runCatching { manager.removeView(view) }
            }
            lastTapAt = now
        }

        runCatching { manager.addView(view, params) }
    }
}
