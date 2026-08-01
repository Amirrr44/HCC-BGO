/**
 * Chat page. The room name in the header is a button that opens the
 * Members page. The dedicated Members icon has been removed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Tooltip,
  Stack,
  Button,
  Snackbar,
  Alert,
} from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../store/session';
import { MessageBubble } from '../components/chat/MessageBubble';
import { MessageInput } from '../components/chat/MessageInput';
import type { ChannelStatus } from '../services/crypto/secureChannel';
import { useBackButton } from '../hooks/useBackButton';

const STATUS_COLOR: Record<ChannelStatus, string> = {
  idle: 'text.secondary',
  connecting: 'warning.main',
  connected: 'success.main',
  reconnecting: 'warning.main',
  disconnected: 'text.secondary',
  error: 'error.main',
};

const STATUS_LABEL: Record<ChannelStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
  error: 'Error',
};

export function ChatPage() {
  const navigate = useNavigate();
  const messages = useSession((s) => s.messages);
  const sendMessage = useSession((s) => s.sendMessage);
  const disconnect = useSession((s) => s.disconnect);
  const status = useSession((s) => s.status);
  const channelInstance = useSession((s) => s.channelInstance);
  const channelName = useSession((s) => s.channel);
  const lastError = useSession((s) => s.lastError);
  const setError = useSession((s) => s.setError);
  const unverifiedHellos = useSession((s) => s.unverifiedHellos);
  const members = useSession((s) => s.members);

  const [backToastMessage, setBackToastMessage] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Back button handler for ChatPage
  const handleBack = useCallback(
    (isDoubleTap: boolean) => {
      if (isDoubleTap) {
        disconnect();
        navigate('/', { replace: true });
      } else {
        setBackToastMessage('برای خروج از اتاق دوباره دکمه بازگشت را بزنید');
      }
    },
    [disconnect, navigate]
  );

  useBackButton({ onBack: handleBack });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!channelInstance && (status === 'disconnected' || status === 'error')) {
      navigate('/');
    }
  }, [channelInstance, status, navigate]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar>
          <Stack sx={{ flex: 1 }}>
            <Button
              onClick={() => navigate('/members')}
              sx={{
                justifyContent: 'flex-start',
                textTransform: 'none',
                color: 'text.primary',
                px: 0,
                minWidth: 0,
                '&:hover': { background: 'transparent', opacity: 0.8 },
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
                #{channelName || 'lobby'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                · {members.length} member{members.length === 1 ? '' : 's'}
              </Typography>
            </Button>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: (theme) => theme.palette[STATUS_COLOR[status].split('.')[0] as 'warning' | 'success' | 'error' | 'text']?.main ?? '#888',
                  transition: 'background-color 200ms',
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {STATUS_LABEL[status]}
              </Typography>
            </Stack>
          </Stack>

          <Tooltip title="Re-broadcast presence">
            <IconButton onClick={() => void channelInstance?.forceHello()}>
              <RefreshRoundedIcon />
            </IconButton>
          </Tooltip>

          <Tooltip title="Disconnect">
            <IconButton
              sx={{ ml: 1 }}
              onClick={() => {
                disconnect();
                navigate('/');
              }}
            >
              <LogoutRoundedIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      {status === 'reconnecting' && (
        <Box
          sx={{
            background: 'rgba(232, 182, 71, 0.14)',
            color: 'warning.main',
            textAlign: 'center',
            py: 0.75,
            fontSize: 13,
            borderBottom: '1px solid rgba(232, 182, 71, 0.2)',
          }}
        >
          Connection lost. Reconnecting…
        </Box>
      )}

      {unverifiedHellos.length > 0 && (
        <Box
          sx={{
            background: 'rgba(226, 125, 106, 0.12)',
            color: 'error.main',
            textAlign: 'center',
            py: 0.75,
            fontSize: 13,
            borderBottom: '1px solid rgba(226, 125, 106, 0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
          }}
        >
          <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
          {unverifiedHellos.length} hello packet{unverifiedHellos.length === 1 ? '' : 's'} rejected (unsigned / bad signature)
        </Box>
      )}

      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: { xs: 1.5, sm: 3 },
          py: 2,
        }}
      >
        {messages.length === 0 && (
          <Stack
            sx={{
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
            }}
          >
            <Typography variant="body2">
              No messages yet. Say hi — and try the 🔒 toggle.
            </Typography>
          </Stack>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} />
        ))}
      </Box>

      <MessageInput
        onSend={(text, encrypted) => sendMessage(text, encrypted)}
        disabled={status !== 'connected'}
      />

      <Snackbar
        open={!!lastError}
        autoHideDuration={3500}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {lastError}
        </Alert>
      </Snackbar>

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
