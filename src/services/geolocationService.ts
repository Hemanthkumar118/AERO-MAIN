export interface GeoLocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
}

export class GeolocationService {
  private watcherId: number | null = null;
  private watchCallbacks: Set<(pos: GeoLocationResult) => void> = new Set();
  private errorCallbacks: Set<(error: GeolocationPositionError) => void> = new Set();

  /**
   * Get the current position once.
   */
  async getCurrentPosition(options?: PositionOptions): Promise<GeoLocationResult> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
          });
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
          ...options
        }
      );
    });
  }

  private lastPosition: { lat: number; lng: number; timestamp: number } | null = null;

  private calculateSpeed(lat1: number, lon1: number, t1: number, lat2: number, lon2: number, t2: number): number {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180; // φ, λ in radians
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    const distance = R * c; // in metres
    const timeSecs = (t2 - t1) / 1000;
    
    if (timeSecs <= 0) return 0;
    return distance / timeSecs; // meters per second
  }

  /**
   * Start watching position continuously.
   */
  startWatching(options?: PositionOptions) {
    if (this.watcherId !== null) return;
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported');
      return;
    }

    this.lastPosition = null;

    this.watcherId = navigator.geolocation.watchPosition(
      (position) => {
        let speed = position.coords.speed;
        
        // If native speed is null, calculate it
        if (speed === null) {
          if (this.lastPosition) {
             speed = this.calculateSpeed(
               this.lastPosition.lat, this.lastPosition.lng, this.lastPosition.timestamp,
               position.coords.latitude, position.coords.longitude, position.timestamp
             );
          } else {
             speed = 0;
          }
        }
        
        this.lastPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: position.timestamp
        };

        const result: GeoLocationResult = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: speed,
        };
        this.watchCallbacks.forEach(cb => cb(result));
      },
      (error) => {
        this.errorCallbacks.forEach(cb => cb(error));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
        ...options
      }
    );
  }

  stopWatching() {
    if (this.watcherId !== null) {
      navigator.geolocation.clearWatch(this.watcherId);
      this.watcherId = null;
    }
  }

  onUpdate(callback: (pos: GeoLocationResult) => void) {
    this.watchCallbacks.add(callback);
    return () => this.watchCallbacks.delete(callback);
  }

  onError(callback: (error: GeolocationPositionError) => void) {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }
}

export const geolocationService = new GeolocationService();
