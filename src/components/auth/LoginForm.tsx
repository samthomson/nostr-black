import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useKeystore } from '@/auth/useKeystore';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';

export interface LoginFormProps {
  /** Called after a successful login. */
  onDone: () => void;
}

/**
 * Login form: nsec only — the private generics need raw-key crypto no
 * signer exposes. The key is remembered on this device so reloads keep
 * you logged in; logout (the account menu) flushes it.
 */
export const LoginForm: React.FC<LoginFormProps> = ({ onDone }) => {
  const [nsecInput, setNsecInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const keystore = useKeystore();

  const handleLogin = () => {
    try {
      keystore.login(nsecInput);
      onDone();
    } catch {
      setLoginError('Invalid key — expected nsec1…');
    }
  };

  return (
    <form
      className="flex flex-col items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        handleLogin();
      }}
    >
      <Input
        type="password"
        value={nsecInput}
        onChange={(e) => setNsecInput(e.target.value)}
        placeholder="nsec1…"
        className="font-mono"
        aria-label="Secret key"
        autoComplete="off"
      />
      {loginError && <p className="text-sm text-destructive text-center">{loginError}</p>}
      <Button
        type="submit"
        variant="privacy"
        disabled={nsecInput.trim().length === 0}
        className={cn(PRIVACY_BUTTON, PRIVACY.private.className)}
      >
        log in
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        remembered on this device — log out to remove it
      </p>
    </form>
  );
};
