import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginScreen from '../LoginScreen';

describe('LoginScreen', () => {
  it('keeps credentials empty and exposes the SSO entry', () => {
    const onSsoLogin = vi.fn();
    render(
      <LoginScreen
        onSubmit={vi.fn()}
        onSsoLogin={onSsoLogin}
        onSwitchToRegister={vi.fn()}
        pending={false}
      />,
    );

    expect(screen.getByLabelText('Username')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'SSO 认证登录' }));
    expect(onSsoLogin).toHaveBeenCalledOnce();
  });
});
