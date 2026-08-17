import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginScreen from '../LoginScreen';

describe('LoginScreen', () => {
  it('keeps credentials empty and exposes both SSO entries', () => {
    const onAegisSsoLogin = vi.fn();
    const onLarkSsoLogin = vi.fn();
    render(
      <LoginScreen
        onSubmit={vi.fn()}
        onAegisSsoLogin={onAegisSsoLogin}
        onLarkSsoLogin={onLarkSsoLogin}
        onSwitchToRegister={vi.fn()}
        pending={false}
      />,
    );

    expect(screen.getByLabelText('Username')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Aegis SSO' }));
    expect(onAegisSsoLogin).toHaveBeenCalledOnce();
    expect(onLarkSsoLogin).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Lark SSO' }));
    expect(onLarkSsoLogin).toHaveBeenCalledOnce();
  });
});
