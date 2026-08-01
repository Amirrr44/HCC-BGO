/**
 * Message composer.
 *
 * Per the design spec, the message input, the message bubbles, and
 * the send button all share the same border radius. We use a single
 * `BUBBLE_RADIUS` constant for visual consistency.
 *
 * The composer includes an encryption toggle (on by default) and a
 * send button. Holding Shift+Enter inserts a newline.
 */

import { useState, useCallback, KeyboardEvent } from 'react';
import { Box, Stack, IconButton, Tooltip, TextField } from '@mui/material';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';

/** Shared border radius for messages, input, and the send button. */
export const BUBBLE_RADIUS = 12;

export function MessageInput({
  onSend,
  disabled,
}: {
  onSend: (text: string, encrypted: boolean) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [encrypt, setEncrypt] = useState(true);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await onSend(trimmed, encrypt);
    setText('');
  }, [text, encrypt, onSend]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <Box
      sx={{
        p: 1.5,
        borderTop: '1px solid',
        borderColor: 'divider',
        background: 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="flex-end" spacing={1.25}>
        <Tooltip title={encrypt ? 'Encrypted message' : 'Plain text'}>
          <IconButton
            onClick={() => setEncrypt((v) => !v)}
            sx={{
              color: encrypt ? 'success.main' : 'text.secondary',
              transition: 'color 150ms',
            }}
            aria-label="Toggle encryption"
          >
            {encrypt ? <LockRoundedIcon /> : <LockOpenRoundedIcon />}
          </IconButton>
        </Tooltip>
        <TextField
          multiline
          maxRows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={encrypt ? 'Send an encrypted message…' : 'Send a plain message…'}
          disabled={disabled}
          className="allow-text-select"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: `${BUBBLE_RADIUS}px`,
            },
          }}
        />
        <Tooltip title="Send">
          <span>
            <IconButton
              onClick={send}
              disabled={disabled || !text.trim()}
              sx={{
                width: 44,
                height: 44,
                borderRadius: `${BUBBLE_RADIUS}px`,
                background: 'primary.main',
                color: 'primary.contrastText',
                '&:hover': { background: 'primary.dark' },
                '&.Mui-disabled': {
                  background: 'action.disabledBackground',
                  color: 'action.disabled',
                },
              }}
            >
              <SendRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
}
