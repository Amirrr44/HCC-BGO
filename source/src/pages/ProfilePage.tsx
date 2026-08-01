/**
 * User Profile page. Manages local-only data:
 *   - Personal QR code (nick + fingerprint + favorite room)
 *   - Editable nickname
 *   - Permanent fingerprint (read-only)
 *   - Favorite room
 *   - Trusted fingerprint registry (manual entries, see-saw)
 *
 * Nothing on this page is ever sent to the server.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  Snackbar,
  Alert,
  Chip,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../store/profile';
import { useSession } from '../store/session';
import { formatFingerprint } from '../services/crypto/crypto';
import { getOrCreateIdentity } from '../services/crypto/identity';
import { renderQrDataUrl, buildProfilePayload } from '../services/protocol/qr';
import {
  addTrusted,
  listTrusted,
  removeTrusted,
  type TrustedFingerprint,
} from '../services/storage/idb';
import { useBackButton } from '../hooks/useBackButton';

export function ProfilePage() {
  const navigate = useNavigate();
  const profile = useProfile((s) => s.profile);
  const setNickname = useProfile((s) => s.setNickname);
  const setFavoriteRoom = useProfile((s) => s.setFavoriteRoom);
  const sessionIdentityFp = useSession((s) => s.identityFingerprintDisplay);

  const [rawFingerprint, setRawFingerprint] = useState<string>('');
  const [displayFingerprint, setDisplayFingerprint] = useState<string>('');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [trusted, setTrusted] = useState<TrustedFingerprint[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addFp, setAddFp] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [snack, setSnack] = useState<string | null>(null);

  // Back button handler for ProfilePage
  const handleBack = useCallback(() => {
    if (addOpen) {
      setAddOpen(false);
      return;
    }
    navigate(-1);
  }, [addOpen, navigate]);

  useBackButton({ onBack: handleBack });

  // Load local identity key on mount even if session is not active
  useEffect(() => {
    let active = true;
    void getOrCreateIdentity().then((id) => {
      if (!active) return;
      setRawFingerprint(id.fingerprint);
      setDisplayFingerprint(formatFingerprint(id.fingerprint));
    });
    return () => {
      active = false;
    };
  }, []);

  // Render the personal QR on mount / whenever profile, session fp or local fp changes
  useEffect(() => {
    const activeFp = sessionIdentityFp || displayFingerprint;
    const activeRawFp = rawFingerprint || activeFp.replace(/[-\s]/g, '');

    if (!activeRawFp) {
      setQrUrl(null);
      return;
    }

    const payload = buildProfilePayload({
      nickname: profile.nickname,
      fingerprint: activeRawFp,
      room: profile.favoriteRoom,
    });

    void renderQrDataUrl(payload, 256)
      .then(setQrUrl)
      .catch(() => setQrUrl(null));
  }, [profile.nickname, profile.favoriteRoom, sessionIdentityFp, displayFingerprint, rawFingerprint]);

  // Load the trusted-fingerprint registry.
  useEffect(() => {
    void listTrusted().then(setTrusted);
  }, []);

  const copyFingerprint = () => {
    const fpToCopy = rawFingerprint || useSession.getState().identity?.fingerprint || '';
    if (fpToCopy) {
      void navigator.clipboard.writeText(fpToCopy);
      setSnack('Fingerprint copied');
    }
  };

  const submitAdd = async () => {
    const fp = addFp.replace(/[-\s]/g, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(fp)) {
      setSnack('Fingerprint must be 64 hex characters');
      return;
    }
    await addTrusted({
      fingerprint: fp,
      label: addLabel || undefined,
      lastNick: undefined,
      lastRoom: profile.favoriteRoom,
      trustedAt: Date.now(),
    });
    setTrusted(await listTrusted());
    setAddOpen(false);
    setAddFp('');
    setAddLabel('');
    setSnack('Fingerprint trusted');
  };

  const remove = async (fp: string) => {
    await removeTrusted(fp);
    setTrusted(await listTrusted());
    setSnack('Trust removed');
  };

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar>
          <IconButton edge="start" onClick={() => navigate(-1)}>
            <ArrowBackRoundedIcon />
          </IconButton>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, ml: 1 }}>
            User Profile
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        <Stack spacing={2} sx={{ maxWidth: 640, mx: 'auto' }}>
          {/* QR card */}
          <Card>
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box
                  sx={{
                    width: 168,
                    height: 168,
                    borderRadius: 2, // 8px for QR container
                    background: 'background.paper',
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                    border: '1px solid',
                    borderColor: 'divider',
                    p: 1.25, // ensure internal padding so QR is fully visible
                  }}
                >
                  {qrUrl ? (
                    <img
                      src={qrUrl}
                      alt="Profile QR"
                      style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: 0, // QR image itself is square, no rounded corners
                        display: 'block',
                      }}
                    />
                  ) : (
                    <Typography variant="caption" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                      QR will appear once your identity is loaded
                    </Typography>
                  )}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Personal QR
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Share this with peers so they can verify your identity.
                    It only contains your nickname, fingerprint, and favorite
                    room — never the private key or password.
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          {/* Editable fields */}
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="overline" color="text.secondary">Identity</Typography>

                <TextField
                  label="Nickname"
                  value={profile.nickname}
                  onChange={(e) => void setNickname(e.target.value)}
                  helperText="Used when joining hack.chat rooms"
                  className="allow-text-select"
                />

                <TextField
                  label="Favorite room"
                  value={profile.favoriteRoom}
                  onChange={(e) => void setFavoriteRoom(e.target.value)}
                  helperText="Used as the default room on the login screen"
                  className="allow-text-select"
                />

                <Box className="allow-text-select">
                  <Typography variant="caption" color="text.secondary">
                    Permanent fingerprint
                  </Typography>
                  <TextField
                    value={sessionIdentityFp || displayFingerprint || '—'}
                    className="allow-text-select"
                    InputProps={{
                      readOnly: true,
                      endAdornment: (
                        <InputAdornment position="end">
                          <Tooltip title="Copy raw fingerprint">
                            <IconButton onClick={copyFingerprint} edge="end">
                              <ContentCopyRoundedIcon />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ),
                    }}
                    sx={{ mt: 0.5 }}
                  />
                </Box>
              </Stack>
            </CardContent>
          </Card>

          {/* Trust registry */}
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Trusted fingerprints
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Manually register fingerprints you have verified out-of-band.
                  </Typography>
                </Box>
                <Button
                  size="small"
                  startIcon={<AddRoundedIcon />}
                  variant="outlined"
                  onClick={() => setAddOpen(true)}
                >
                  Add
                </Button>
              </Stack>
              <Divider sx={{ mb: 1 }} />
              {trusted.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                  No trusted fingerprints yet.
                </Typography>
              ) : (
                <List dense>
                  {trusted.map((t) => (
                    <ListItem
                      key={t.fingerprint}
                      secondaryAction={
                        <Tooltip title="Remove trust">
                          <IconButton onClick={() => void remove(t.fingerprint)}>
                            <DeleteOutlineRoundedIcon />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <ListItemText
                        primary={
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Typography
                              variant="body2"
                              className="allow-text-select"
                              sx={{ fontFamily: 'monospace' }}
                            >
                              {formatFingerprint(t.fingerprint)}
                            </Typography>
                            <Chip size="small" label="Trusted" color="success" sx={{ height: 18, fontSize: 10 }} />
                          </Stack>
                        }
                        secondary={
                          <>
                            {t.label ? <span>{t.label} · </span> : null}
                            {t.lastNick ? <span>last seen as “{t.lastNick}” · </span> : null}
                            {t.lastRoom ? <span>trusted in #{t.lastRoom}</span> : null}
                          </>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Box>

      {/* Add dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Trust a fingerprint</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              label="Fingerprint (64 hex)"
              value={addFp}
              onChange={(e) => setAddFp(e.target.value)}
              placeholder="91af23bc8f4e..."
              fullWidth
              className="allow-text-select"
            />
            <TextField
              label="Label (optional)"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              placeholder="Alice's laptop"
              fullWidth
              className="allow-text-select"
            />
            <Typography variant="caption" color="text.secondary">
              Verify the fingerprint out-of-band (e.g. voice call) before
              trusting it. The room recorded here is your favorite room at
              the time of insertion: <strong>#{profile.favoriteRoom}</strong>.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void submitAdd()}>
            Trust
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snack}
        autoHideDuration={2400}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSnack(null)}>
          {snack}
        </Alert>
      </Snackbar>
    </Box>
  );
}
