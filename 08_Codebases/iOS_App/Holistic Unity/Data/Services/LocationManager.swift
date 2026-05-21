import CoreLocation

@MainActor
@Observable
final class LocationManager: NSObject {
    static let shared = LocationManager()
    
    var userLatitude: Double?
    var userLongitude: Double?
    var authorizationStatus: CLAuthorizationStatus = .notDetermined
    
    var hasLocation: Bool {
        userLatitude != nil && userLongitude != nil
    }
    
    private let manager = CLLocationManager()
    
    private override init() {
        super.init()
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        manager.delegate = self
        authorizationStatus = manager.authorizationStatus
    }
    
    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }
    
    func requestLocation() {
        guard manager.authorizationStatus == .authorizedWhenInUse ||
              manager.authorizationStatus == .authorizedAlways else {
            requestPermission()
            return
        }
        manager.requestLocation()
    }
}

extension LocationManager: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            userLatitude = location.coordinate.latitude
            userLongitude = location.coordinate.longitude
        }
    }
    
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Location request failed — ignore silently, user can retry
    }
    
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            authorizationStatus = status
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                manager.requestLocation()
            }
        }
    }
}
