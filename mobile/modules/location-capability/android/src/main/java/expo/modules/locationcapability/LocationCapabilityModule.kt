package expo.modules.locationcapability

import android.content.pm.PackageManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hardware capability only: does the device declare any way to get a location
 * (GPS chip or network/Wi-Fi location)? It says nothing about permission or the
 * location switch, which the location gate reads separately.
 */
class LocationCapabilityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LocationCapability")

    Function("hasLocationHardware") {
      val packageManager = (appContext.reactContext ?: throw Exceptions.ReactContextLost()).packageManager
      packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS) ||
        packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_NETWORK)
    }
  }
}
