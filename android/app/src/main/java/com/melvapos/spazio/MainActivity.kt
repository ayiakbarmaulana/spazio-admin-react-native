package com.melvapos.spazio

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "SpazioNativePOS"

  /**
   * Layar pembuka ditampilkan oleh SplashTheme. `super.onCreate(null)` (bukan
   * [Bundle]) karena React Native menangani pemulihan state-nya sendiri —
   * meneruskan savedInstanceState membuat fragmen di-restore dua kali.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.SplashTheme)
    super.onCreate(null)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        /**
         * Dipanggil tepat sebelum ReactRootView dipasang lewat setContentView —
         * di titik ini windowBackground SplashTheme tidak dipakai lagi, jadi
         * tema aman dikembalikan ke AppTheme dan layar pembuka hilang tanpa
         * kedipan putih di antaranya.
         */
        override fun loadApp(appKey: String?) {
          setTheme(R.style.AppTheme)
          super.loadApp(appKey)
        }
      }
}
