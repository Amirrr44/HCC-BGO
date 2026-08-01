/**
 * Single chat message bubble.
 *
 * Encrypted messages that we can decrypt render as normal text. Encrypted
 * messages we cannot decrypt render a friendly placeholder with a
 * "Show Raw" toggle that reveals the original encoded payload.
 */

import { useState } from 'react';
import { Box, Stack, Typography, IconButton, Tooltip, Collapse, Paper } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import type { ChatMessage } from '../../types';
import { BUBBLE_RADIUS } from './MessageInput';

export function MessageBubble({ msg }: { msg: ChatMessage }) {
  const [showRaw, setShowRaw] = useState(false);

  const isSelf = msg.self;
  const isEncrypted = msg.encrypted;
  const isUndecryptable = msg.undecryptable;
  const signatureInvalid = msg.signatureInvalid;

  // Bubble color: self messages use the primary palette, others use a
  // neutral surface tone.
  const bubbleBg = isSelf ? 'primary.main' : 'background.paper';
  const bubbleFg = isSelf ? 'primary.contrastText' : 'text.primary';

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isSelf ? 'flex-end' : 'flex-start',
        mb: 1,
        animation: 'fade-in 220ms ease',
        '@keyframes fade-in': {
          from: { opacity: 0, transform: 'translateY(4px)' },
          to: { opacity: 1, transform: 'none' },
        },
      }}
    >
      <Stack
        spacing={0.5}
        sx={{ maxWidth: { xs: '88%', sm: '70%' }, alignItems: isSelf ? 'flex-end' : 'flex-start' }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {msg.nick}
          </Typography>
          {isEncrypted && !isUndecryptable && (
            <Tooltip title="End-to-end encrypted">
              <LockRoundedIcon sx={{ fontSize: 12, color: 'success.light' }} />
            </Tooltip>
          )}
          {isUndecryptable && (
            <Tooltip title="Encrypted message — could not be decrypted">
              <LockOpenRoundedIcon sx={{ fontSize: 12, color: 'warning.main' }} />
            </Tooltip>
          )}
          {signatureInvalid && (
            <Tooltip title="Signature verification failed">
              <WarningAmberRoundedIcon sx={{ fontSize: 14, color: 'warning.main' }} />
            </Tooltip>
          )}
        </Stack>
        <Paper
          elevation={0}
          sx={{
            px: 1.75,
            py: 1.1,
            borderRadius: `${BUBBLE_RADIUS}px`,
            backgroundColor: bubbleBg,
            color: bubbleFg,
            wordBreak: 'break-word',
            border: isSelf ? 'none' : '1px solid',
            borderColor: isSelf ? 'transparent' : 'divider',
          }}
        >
          {isUndecryptable ? (
            <Stack spacing={0.5}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <LockRoundedIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Encrypted message
                </Typography>
              </Stack>
              <Typography variant="caption" sx={{ opacity: 0.85 }}>
                Unable to decrypt. The shared password may not match.
              </Typography>
              <Box>
                <IconButton
                  size="small"
                  onClick={() => setShowRaw((v) => !v)}
                  sx={{ color: 'inherit', opacity: 0.85 }}
                >
                  <ExpandMoreRoundedIcon
                    sx={{
                      transform: showRaw ? 'rotate(180deg)' : 'none',
                      transition: 'transform 150ms',
                    }}
                  />
                  <Typography variant="caption" sx={{ ml: 0.5 }}>
                    {showRaw ? 'Hide Raw' : 'Show Raw'}
                  </Typography>
                </IconButton>
              </Box>
              <Collapse in={showRaw}>
                <Box
                  className="allow-text-select"
                  sx={{
                    mt: 1,
                    p: 1,
                    borderRadius: 3,
                    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                    fontSize: 11,
                    wordBreak: 'break-all',
                    background: 'rgba(0,0,0,0.25)',
                    color: 'inherit',
                  }}
                >
                  {msg.raw}
                </Box>
              </Collapse>
            </Stack>
          ) : (
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {msg.text}
            </Typography>
          )}
        </Paper>
        {signatureInvalid && !isUndecryptable && (
          <Typography variant="caption" color="warning.main" sx={{ px: 1 }}>
            ⚠ Signature could not be verified.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
