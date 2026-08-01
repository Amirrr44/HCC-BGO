/**
 * Members page. Renders every connected user with a status indicator
 * and a click-through detail dialog. Also surfaces:
 *   - The current server address and room name
 *   - A Room QR code (server + channel only — no secrets)
 *   - A Shared Password card with explicit Show / Hide
 *   - The local trust registry
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Snackbar,
  Alert,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CircleRoundedIcon from '@mui/icons-material/CircleRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import QrCodeRoundedIcon from '@mui/icons-material/QrCodeRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../store/session';
import type { Member, MemberStatus } from '../types';
import { formatFingerprint } from '../services/crypto/crypto';
import { renderQrDataUrl, buildRoomPayload } from '../services/protocol/qr';
import { useBackButton } from '../hooks/useBackButton';

const STATUS_COLOR: Record<MemberStatus, string> = {
  unknown: '#8B7E6B',
  plain: '#3D342B',
  'wrong-password': '#E27D6A',
  untrusted: '#E8B647',
  trusted: '#8FB377',
};

const STATUS_LABEL: Record<MemberStatus, string> = {
  unknown: 'No signal yet',
  plain: 'Plain hack.chat user',
  'wrong-password': 'Password mismatch',
  untrusted: 'Password OK — unverified',
  trusted: 'Trusted fingerprint',
};

export function MembersPage() {
  const navigate = useNavigate();
  const members = useSession((s) => s.members);
  const channelInstance = useSession((s) => s.channelInstance);
  const serverUrl = useSession((s) => s.serverUrl);
  const channel = useSession((s) => s.channel);
  const password = useSession((s) => s.password);

  const [openMember, setOpenMember] = useState<Member | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [roomQrUrl, setRoomQrUrl] = useState<string | null>(null);

  // Back button handler for MembersPage
  const handleBack = useCallback(() => {
    if (openMember) {
      setOpenMember(null);
      return;
    }
    navigate(-1);
  }, [openMember, navigate]);

  useBackButton({ onBack: handleBack });

  // Render the Room QR on mount / whenever server/channel change.
  useEffect(() => {
    if (!serverUrl || !channel) {
      setRoomQrUrl(null);
      return;
    }
    void renderQrDataUrl(buildRoomPayload(serverUrl, channel), 220)
      .then(setRoomQrUrl)
      .catch(() => setRoomQrUrl(null));
  }, [serverUrl, channel]);

  const sorted = useMemo(
    () => [...members].sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [members],
  );

  const onTrust = async (member: Member) => {
    if (!member.fingerprint) return;
    if (!channelInstance) return;
    await channelInstance.trustFingerprint({
      fingerprint: member.fingerprint,
      label: member.nickname,
      nick: member.nickname,
      room: channel,
    });
    setOpenMember(null);
    setSnack(`Trusted ${member.nickname}`);
  };

  const onUntrust = async (member: Member) => {
    if (!member.fingerprint) return;
    const { removeTrusted } = await import('../services/storage/idb');
    await removeTrusted(member.fingerprint);
    channelInstance?.refreshTrust(member.fingerprint, false);
    setOpenMember(null);
    setSnack(`Removed trust for ${member.nickname}`);
  };

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar>
          <IconButton edge="start" onClick={() => navigate(-1)}>
            <ArrowBackRoundedIcon />
          </IconButton>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, ml: 1 }}>
            Members
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Chip
            label={`${members.length} online`}
            size="small"
            variant="outlined"
            sx={{ borderRadius: 2 }}
          />
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        <Stack spacing={2} sx={{ p: 2, maxWidth: 720, mx: 'auto' }}>
          {/* Server + Room card */}
          <Card>
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box sx={{ flex: 1 }}>
                  <Typography variant="overline" color="text.secondary">Server</Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                    {serverUrl || '—'}
                  </Typography>
                  <Typography variant="overline" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Room
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    #{channel || 'lobby'}
                  </Typography>
                </Box>
                <Stack alignItems="center" spacing={0.5}>
                  {roomQrUrl ? (
                    <Box
                      sx={{
                        width: 120,
                        height: 120,
                        borderRadius: 2, // 8px QR container
                        background: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        p: 0.75, // internal padding so QR is fully visible
                        display: 'grid',
                        placeItems: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={roomQrUrl}
                        alt="Room QR"
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: 0, // QR image itself: square, no rounded corners
                          display: 'block',
                        }}
                      />
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        width: 120,
                        height: 120,
                        borderRadius: 2, // 8px QR container
                        background: 'background.paper',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <QrCodeRoundedIcon sx={{ opacity: 0.3 }} />
                    </Box>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    Room QR
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {/* Shared Password card — read-only information row */}
          <Card>
            <CardContent>
              <Stack spacing={1}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="overline" color="text.secondary">
                      Shared password
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Stays on this device. Never sent to the server. Read-only.
                    </Typography>
                  </Box>
                  <Tooltip title={showPassword ? 'Hide password' : 'Show password'}>
                    <span>
                      <IconButton
                        onClick={() => setShowPassword((v) => !v)}
                        disabled={!password}
                      >
                        {showPassword ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Copy password">
                    <span>
                      <IconButton
                        onClick={() => {
                          if (password) void navigator.clipboard.writeText(password);
                          setSnack('Password copied');
                        }}
                        disabled={!password}
                      >
                        <ContentCopyRoundedIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>

                {password ? (
                  <Box
                    className={showPassword ? 'allow-text-select' : undefined}
                    sx={{
                      mt: 0.5,
                      px: 1.5,
                      py: 1.25,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      background: (theme) =>
                        theme.palette.mode === 'dark'
                          ? 'rgba(255,255,255,0.03)'
                          : 'rgba(0,0,0,0.02)',
                      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                      fontSize: 14,
                      wordBreak: 'break-all',
                      letterSpacing: 0.4,
                      ...(showPassword
                        ? { color: 'text.primary' }
                        : {
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                          }),
                    }}
                    aria-readonly="true"
                  >
                    {showPassword
                      ? password
                      : '•'.repeat(Math.max(8, Math.min(password.length, 24)))}
                  </Box>
                ) : (
                  <Box
                    sx={{
                      mt: 0.5,
                      px: 1.5,
                      py: 1.25,
                      borderRadius: 2,
                      border: '1px dashed',
                      borderColor: 'divider',
                      color: 'text.secondary',
                      fontStyle: 'italic',
                      fontSize: 14,
                    }}
                  >
                    No shared password set for this room.
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>

          {/* Members list */}
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                Connected ({members.length})
              </Typography>
              <Divider sx={{ mb: 1 }} />
              {sorted.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                  No members yet.
                </Typography>
              ) : (
                <List sx={{ p: 0 }}>
                  {sorted.map((m) => {
                    const fpDisplay = m.fingerprint ? formatFingerprint(m.fingerprint) : '—';
                    return (
                      <ListItem key={m.nickname} disablePadding sx={{ mb: 0.5 }}>
                        <ListItemButton onClick={() => setOpenMember(m)} sx={{ borderRadius: 2 }}>
                          <Tooltip title={STATUS_LABEL[m.status]}>
                            <CircleRoundedIcon
                              sx={{ color: STATUS_COLOR[m.status], fontSize: 14, mr: 1.5 }}
                            />
                          </Tooltip>
                          <ListItemText
                            primary={
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  {m.nickname}
                                </Typography>
                                {m.fingerprint && m.status === 'trusted' && (
                                  <Chip size="small" label="Trusted" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                                )}
                              </Stack>
                            }
                            secondary={
                              <Typography
                                variant="caption"
                                className="allow-text-select"
                                sx={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' }}
                              >
                                {fpDisplay}
                              </Typography>
                            }
                          />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Box>

      <Dialog
        open={!!openMember}
        onClose={() => setOpenMember(null)}
        maxWidth="xs"
        fullWidth
      >
        {openMember && (
          <>
            <DialogTitle sx={{ pb: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <CircleRoundedIcon sx={{ color: STATUS_COLOR[openMember.status], fontSize: 14 }} />
                <Typography variant="h6">{openMember.nickname}</Typography>
              </Stack>
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Status</Typography>
                  <Typography variant="body2">{STATUS_LABEL[openMember.status]}</Typography>
                </Box>
                <Divider />
                <Box>
                  <Typography variant="caption" color="text.secondary">Fingerprint</Typography>
                  <Typography
                    variant="body2"
                    className="allow-text-select"
                    sx={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', wordBreak: 'break-all' }}
                  >
                    {openMember.fingerprint ? formatFingerprint(openMember.fingerprint) : '—'}
                  </Typography>
                </Box>
                {openMember.fingerprint && (openMember.status === 'trusted' ? (
                  <Button variant="outlined" color="warning" onClick={() => void onUntrust(openMember)}>
                    Remove Trust
                  </Button>
                ) : (
                  <Button variant="contained" onClick={() => void onTrust(openMember)}>
                    Verify &amp; Trust
                  </Button>
                ))}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenMember(null)}>Close</Button>
            </DialogActions>
          </>
        )}
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
