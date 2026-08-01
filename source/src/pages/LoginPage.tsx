/**
 * Login page.
 *
 * Fields:
 *   - Room (required, the only field at the top level)
 *   - Collapsible "Advanced" section containing:
 *       - Server Address
 *       - Shared Password
 *   - Two side-action buttons: QR code reader, profile.
 *
 * The nickname is no longer a login field — it is read from the user
 * profile (see `useProfile`). The shared password is never sent to
 * the server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
  CircularProgress,
  Link,
  Snackbar,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import QrCodeScannerRoundedIcon from '@mui/icons-material/QrCodeScannerRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import CameraswitchRoundedIcon from '@mui/icons-material/CameraswitchRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useSession } from '../store/session';
import { useProfile } from '../store/profile';
import { formatFingerprint } from '../services/crypto/crypto';
import { useQrScanner } from '../hooks/useQrScanner';
import { parseQrPayload } from '../services/protocol/qr';
import { getOrCreateIdentity } from '../services/crypto/identity';
import { getPref, setPref, deletePref, addTrusted } from '../services/storage/idb';
import { useBackButton } from '../hooks/useBackButton';

export function LoginPage() {
  const navigate = useNavigate();
  const setCredentials = useSession((s) => s.setCredentials);
  const connect = useSession((s) => s.connect);
  const lastError = useSession((s) => s.lastError);
  const setError = useSession((s) => s.setError);
  const profile = useProfile((s) => s.profile);
  const profileReady = useProfile((s) => s.ready);
  const initProfile = useProfile((s) => s.init);

  // Bootstrap the profile on first mount.
  useEffect(() => {
    void initProfile();
  }, [initProfile]);

  const [serverUrl, setServerUrl] = useState('https://hack.chat');
  const [channel, setChannel] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Success message for profile imports via QR
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Back button toast state
  const [backToastMessage, setBackToastMessage] = useState<string | null>(null);

  // Remember Last Session — checkbox state and remembered values.
  const REMEMBER_ENABLED_KEY = 'login.rememberEnabled';
  const REMEMBERED_VALUES_KEY = 'login.rememberedValues';
  const [rememberLastSession, setRememberLastSession] = useState(true);
  const [rememberLoaded, setRememberLoaded] = useState(false);

  // Load the checkbox state and (when enabled) the remembered values
  // from IndexedDB on mount. The checkbox state itself is always
  // remembered, even when the values aren't.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const enabledPref = await getPref<boolean>(REMEMBER_ENABLED_KEY);
        if (cancelled) return;
        // Default state is "enabled" when nothing is stored yet.
        const enabled = enabledPref === null ? true : !!enabledPref;
        setRememberLastSession(enabled);
        if (enabled) {
          const remembered = await getPref<{
            serverUrl?: string;
            channel?: string;
            password?: string;
          }>(REMEMBERED_VALUES_KEY);
          if (cancelled) return;
          if (remembered) {
            if (typeof remembered.serverUrl === 'string') setServerUrl(remembered.serverUrl);
            if (typeof remembered.channel === 'string') setChannel(remembered.channel);
            if (typeof remembered.password === 'string') setPassword(remembered.password);
          }
        }
        if (!cancelled) setRememberLoaded(true);
      } catch {
        if (!cancelled) setRememberLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // When the checkbox toggles, persist its state and either save the
  // current values or wipe any previously remembered values.
  useEffect(() => {
    if (!rememberLoaded) return;
    void setPref(REMEMBER_ENABLED_KEY, rememberLastSession);
    if (rememberLastSession) {
      void setPref(REMEMBERED_VALUES_KEY, {
        serverUrl,
        channel,
        password,
      });
    } else {
      // Immediately delete any previously stored values.
      void deletePref(REMEMBERED_VALUES_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rememberLastSession, rememberLoaded]);

  // Whenever the credentials change while "remember" is on, persist
  // the latest values.
  useEffect(() => {
    if (!rememberLoaded) return;
    if (!rememberLastSession) return;
    void setPref(REMEMBERED_VALUES_KEY, {
      serverUrl,
      channel,
      password,
    });
  }, [serverUrl, channel, password, rememberLastSession, rememberLoaded]);

  // QR scanner dialog state.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanStage, setScanStage] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [scanError, setScanError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanner = useQrScanner(videoRef as React.RefObject<HTMLVideoElement | null>);

  const closeScanner = useCallback(() => {
    // Always release the camera when the QR reader is dismissed.
    scanner.stop();
    setScannerOpen(false);
    setScanStage('idle');
  }, [scanner]);

  // Back button handler for LoginPage
  const handleBack = useCallback(
    (isDoubleTap: boolean) => {
      if (scannerOpen) {
        closeScanner();
        return;
      }

      if (isDoubleTap) {
        if ((window as any).Capacitor?.Plugins?.App) {
          (window as any).Capacitor.Plugins.App.exitApp();
        } else {
          window.history.back();
        }
      } else {
        setBackToastMessage('برای خروج دوباره دکمه بازگشت را بزنید');
      }
    },
    [scannerOpen, closeScanner]
  );

  useBackButton({ onBack: handleBack });

  // When the scanner finds a code, parse it and apply.
  // Supports both room QR codes and profile QR codes.
  useEffect(() => {
    if (!scanner.result) return;
    const parsed = parseQrPayload(scanner.result);
    // Release the camera immediately on a successful scan
    scanner.stop();
    setScannerOpen(false);

    if (parsed?.kind === 'shc.room') {
      setServerUrl(parsed.server);
      setChannel(parsed.channel);
      setAdvancedOpen(true);
      setScanStage('success');
      setSuccessMessage(`Room #${parsed.channel} loaded from QR code`);
      setTimeout(() => {
        setScanStage('idle');
        setSuccessMessage(null);
      }, 3000);
    } else if (parsed?.kind === 'shc.profile') {
      // Save profile to trust registry
      void addTrusted({
        fingerprint: parsed.fingerprint,
        label: parsed.nickname,
        nick: parsed.nickname,
        room: parsed.room,
        addedAt: Date.now(),
      }).then(() => {
        setScanStage('success');
        setSuccessMessage(`Trusted user "${parsed.nickname}" added successfully!`);
        setTimeout(() => {
          setScanStage('idle');
          setSuccessMessage(null);
        }, 3000);
      });
    } else {
      setScanStage('error');
      setScanError('QR code is not a recognized room/profile code');
      setTimeout(() => setScanStage('idle'), 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.result]);

  const onConnect = useCallback(async () => {
    if (!profileReady) {
      setError('Profile is still loading — try again in a moment.');
      return;
    }
    if (!profile.nickname.trim()) {
      setError('Please set a nickname in your profile first.');
      return;
    }
    setBusy(true);
    setError(null);
    setCredentials({ serverUrl, channel, password });
    await connect();
    setBusy(false);
    if (!useSession.getState().lastError) {
      navigate('/chat');
    }
  }, [profileReady, profile.nickname, serverUrl, channel, password, setCredentials, connect, navigate, setError]);

  const openScanner = async () => {
    setScannerOpen(true);
    setScanStage('scanning');
    setScanError(null);
    // Give the dialog a tick to mount before requesting the camera so
    // the <video> element exists when the stream attaches.
    setTimeout(() => {
      void scanner.start();
    }, 100);
  };

  const retryScanner = () => {
    setScanError(null);
    void scanner.start();
  };

  const [identityFpDisplay, setIdentityFpDisplay] = useState<string>('');
  useEffect(() => {
    void getOrCreateIdentity().then((id) => setIdentityFpDisplay(formatFingerprint(id.fingerprint)));
  }, []);

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
      }}
    >
      <Card
        elevation={6}
        sx={{
          width: '100%',
          maxWidth: 460,
          borderRadius: 3,
          backgroundColor: 'background.paper',
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={3}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '12px',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'linear-gradient(135deg,#E89B3C,#B87520)',
                  color: '#FFFAF0',
                }}
              >
                <ShieldRoundedIcon />
              </Box>
              <Box>
                <Typography variant="h6" sx={{ lineHeight: 1 }}>
                  Secure Hack.Chat
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  End-to-end encrypted client
                </Typography>
              </Box>
            </Stack>

            {lastError && <Alert severity="error">{lastError}</Alert>}
            {successMessage && <Alert severity="success">{successMessage}</Alert>}

            <Stack spacing={2}>
              <TextField
                label="Room"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="lobby"
                autoFocus
                helperText={profileReady ? `Joining as ${profile.nickname || 'anon'}` : 'Loading profile…'}
                className="allow-text-select"
              />

              <Box>
                <Button
                  fullWidth
                  variant="text"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  endIcon={
                    <ExpandMoreRoundedIcon
                      sx={{
                        transform: advancedOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 150ms',
                      }}
                    />
                  }
                  sx={{ justifyContent: 'space-between' }}
                >
                  Advanced
                </Button>
                <Collapse in={advancedOpen} unmountOnExit>
                  <Stack spacing={2} sx={{ pt: 1 }}>
                    <TextField
                      label="Server address"
                      value={serverUrl}
                      onChange={(e) => setServerUrl(e.target.value)}
                      placeholder="https://hack.chat"
                      helperText="Any hack.chat fork or self-hosted instance."
                      className="allow-text-select"
                    />
                    <TextField
                      label="Shared password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      helperText="Used only to derive the room key locally."
                      className="allow-text-select"
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <Tooltip title={showPassword ? 'Hide password' : 'Show password'}>
                              <IconButton
                                onClick={() => setShowPassword((v) => !v)}
                                edge="end"
                              >
                                {showPassword ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                              </IconButton>
                            </Tooltip>
                          </InputAdornment>
                        ),
                      }}
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={rememberLastSession}
                          onChange={(e) => setRememberLastSession(e.target.checked)}
                        />
                      }
                      label={
                        <Typography variant="body2">
                          Remember last server, room, and shared password
                        </Typography>
                      }
                    />
                  </Stack>
                </Collapse>
              </Box>
            </Stack>

            <Stack direction="row" spacing={1.5}>
              <Tooltip title="Scan a room or profile QR code">
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<QrCodeScannerRoundedIcon />}
                  onClick={() => void openScanner()}
                >
                  QR
                </Button>
              </Tooltip>
              <Tooltip title="Open your profile (nickname, fingerprint, trusted peers)">
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<PersonRoundedIcon />}
                  onClick={() => navigate('/profile')}
                >
                  Profile
                </Button>
              </Tooltip>
            </Stack>

            <Button
              size="large"
              variant="contained"
              onClick={() => void onConnect()}
              disabled={busy || !channel || !profileReady}
              startIcon={<LockRoundedIcon />}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </Button>

            {identityFpDisplay && (
              <Box sx={{ pt: 1 }} className="allow-text-select">
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  Your fingerprint
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', letterSpacing: 0.4 }}
                >
                  {identityFpDisplay}
                </Typography>
              </Box>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ pt: 1 }}>
              By connecting you agree to be a good citizen.{' '}
              <Link href="https://hack.chat" target="_blank" rel="noreferrer" color="inherit">
                What is hack.chat?
              </Link>
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      {/* QR scanner dialog */}
      <Dialog
        open={scannerOpen}
        onClose={closeScanner}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle>Scan room or profile QR</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Box
              sx={{
                position: 'relative',
                aspectRatio: '1 / 1',
                background: '#000',
                borderRadius: 2, // 8px (QR container)
                overflow: 'hidden',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {scanStage === 'scanning' && !scanner.active && !scanner.error && (
                <Stack sx={{ position: 'absolute', color: '#fff' }} alignItems="center">
                  <CircularProgress size={20} sx={{ mb: 1, color: '#fff' }} />
                  <Typography variant="caption">Starting camera…</Typography>
                </Stack>
              )}
              {scanStage === 'success' && (
                <Box sx={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', color: '#fff' }}>
                  <Typography>QR applied</Typography>
                </Box>
              )}
            </Box>
            {scanner.error && (
              <Stack spacing={1}>
                <Alert severity="warning">
                  {scanner.permissionDenied
                    ? 'We need camera access to scan the QR code. Please allow camera permission in your browser settings, then tap Retry.'
                    : scanner.error}
                </Alert>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<RefreshRoundedIcon />}
                  onClick={retryScanner}
                >
                  Retry
                </Button>
              </Stack>
            )}
            {scanError && <Alert severity="error">{scanError}</Alert>}
            <Typography variant="caption" color="text.secondary">
              Server address, room name, or user profile fingerprints are read from the QR code.
              The shared password, private key, and identity secrets are
              never included in a QR code.
            </Typography>
          </Stack>
        </DialogContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2, pt: 0 }}>
          {scanner.hasMultipleCameras ? (
            <Tooltip title="Switch camera">
              <Button
                onClick={() => void scanner.switchCamera()}
                startIcon={<CameraswitchRoundedIcon />}
                disabled={!scanner.active}
              >
                Switch camera
              </Button>
            </Tooltip>
          ) : (
            <Box />
          )}
          <Button onClick={closeScanner}>Close</Button>
        </Stack>
      </Dialog>

      <Snackbar
        open={!!backToastMessage}
        autoHideDuration={2000}
        onClose={() => setBackToastMessage(null)}
        message={backToastMessage}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        ContentProps={{
          sx: {
            backgroundColor: 'rgba(40, 40, 40, 0.95)',
            color: '#fff',
            borderRadius: '20px',
            px: 2.5,
            py: 0.5,
            minWidth: 'auto',
            fontSize: '0.825rem',
            fontWeight: 500,
          },
        }}
      />
    </Box>
  );
}
