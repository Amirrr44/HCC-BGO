/**
 * Camera QR scanner hook.
 * Modified for seamless compatibility with Capacitor WebView & Native Mobile.
 */

import { useEffect, useRef, useState } from 'react';
import { decodeQr } from '../services/protocol/qr';

export interface QrCamera {
  deviceId: string;
  label: string;
}

export interface QrScannerState {
  result: string | null;
  active: boolean;
  error: string | null;
  permissionDenied: boolean;
  hasMultipleCameras: boolean;
  stop: () => void;
  start: () => Promise<void>;
  switchCamera: () => Promise<void>;
}

export function useQrScanner(videoRef: React.RefObject<HTMLVideoElement | null>): QrScannerState {
  const [result, setResult] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [cameras, setCameras] = useState<QrCamera[]>([]);
  const [currentCameraId, setCurrentCameraId] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);

  const releaseStream = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      try {
        for (const track of streamRef.current.getTracks()) track.stop();
      } catch {
        /* ignore */
      }
      streamRef.current = null;
    }
  };

  const stop = () => {
    stoppedRef.current = true;
    releaseStream();
    setActive(false);
  };

  const isPermissionDeniedError = (e: unknown): boolean => {
    if (!e || typeof e !== 'object') return false;
    const name = (e as { name?: string }).name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return true;
    }
    const message = (e as { message?: string }).message ?? '';
    return /permission\s*denied/i.test(message);
  };

  const enumerateCameras = async (): Promise<QrCamera[]> => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Camera' }));
    } catch {
      return [];
    }
  };

  const openStream = async (deviceId: string | null) => {
    // Basic constraint setup for mobile webviews
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: 'environment' } },
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  };

  const attachAndDecode = (stream: MediaStream) => {
    const video = videoRef.current;
    if (!video) {
      throw new Error('No video element to attach the stream to.');
    }
    
    // Inline play setting for iOS WebView compatibility
    video.setAttribute('playsinline', 'true');
    video.srcObject = stream;
    
    return video.play().then(() => {
      setActive(true);
      const tick = () => {
        if (stoppedRef.current) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2) {
          const w = v.videoWidth;
          const h = v.videoHeight;
          if (w > 0 && h > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              try {
                ctx.drawImage(v, 0, 0, w, h);
                const img = ctx.getImageData(0, 0, w, h);
                const text = decodeQr(img.data, w, h);
                if (text) {
                  setResult(text);
                  stop();
                  return;
                }
              } catch {
                /* ignore frame errors */
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    });
  };

  const start = async () => {
    setError(null);
    setResult(null);
    setPermissionDenied(false);
    stoppedRef.current = false;
    releaseStream();

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this environment.');
      setActive(false);
      return;
    }

    try {
      // Step 1: Force initial permission prompt FIRST without exact constraints.
      // WebView blocks device enumeration until user explicitly allows media stream.
      let stream: MediaStream;
      try {
        stream = await openStream(null);
      } catch (err) {
        throw err; // rethrow to be caught by main error handler
      }

      streamRef.current = stream;

      // Step 2: Now that permission IS GRANTED, enumerate available cameras with labels
      const detected = await enumerateCameras();
      setCameras(detected);

      // Step 3: Switch to rear camera if detected and current stream is default
      if (detected.length > 0) {
        const rear = detected.find((c) => /back|rear|environment/i.test(c.label));
        const preferredId = rear?.deviceId ?? detected[0].deviceId;
        setCurrentCameraId(preferredId);
      }

      await attachAndDecode(stream);
    } catch (e) {
      if (isPermissionDeniedError(e)) {
        setPermissionDenied(true);
        setError(
          'Camera access was blocked. Please grant camera permission in system settings.',
        );
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setActive(false);
      releaseStream();
    }
  };

  const currentDeviceIndex = (): number => {
    if (!currentCameraId) return 0;
    const i = cameras.findIndex((c) => c.deviceId === currentCameraId);
    return i < 0 ? 0 : i;
  };

  const switchCamera = async () => {
    if (cameras.length < 2) return;
    const idx = currentDeviceIndex();
    const next = cameras[(idx + 1) % cameras.length];
    stoppedRef.current = false;
    releaseStream();
    setActive(false);
    setError(null);
    try {
      const stream = await openStream(next.deviceId);
      streamRef.current = stream;
      setCurrentCameraId(next.deviceId);
      await attachAndDecode(stream);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActive(false);
      releaseStream();
    }
  };

  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  return {
    result,
    active,
    error,
    permissionDenied,
    hasMultipleCameras: cameras.length > 1,
    stop,
    start,
    switchCamera,
  };
}
