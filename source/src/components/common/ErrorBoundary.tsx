/**
 * A tiny error boundary that prevents the whole app from crashing when an
 * unhandled exception bubbles up from a child.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Stack } from '@mui/material';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('AppErrorBoundary caught:', error, info);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      return (
        <Box
          sx={{
            minHeight: '100dvh',
            display: 'grid',
            placeItems: 'center',
            p: 3,
            background: '#0E0E12',
          }}
        >
          <Stack spacing={2} sx={{ maxWidth: 480, textAlign: 'center' }}>
            <Typography variant="h5">Something went wrong.</Typography>
            <Typography variant="body2" color="text.secondary">
              {this.state.error.message}
            </Typography>
            <Button variant="contained" onClick={this.reset}>
              Try again
            </Button>
          </Stack>
        </Box>
      );
    }
    return this.props.children;
  }
}
