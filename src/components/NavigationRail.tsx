import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isMac } from '../lib/desktop';
import { initials } from '../lib/preferences';
import { ChatsIcon, ChevronRightIcon, GearIcon, HelpIcon, HistoryIcon, HomeIcon, LogOutIcon, UserIcon } from './Icons';

interface Props {
  userName: string;
  subscriptionCount: number;
  homeActive: boolean;
  historyOpen: boolean;
  onHome: () => void;
  onHomeHover?: (hovering: boolean) => void;
  onToggleHistory: () => void;
  scheduledActive: boolean;
  onScheduled: () => void;
  onSettings: () => void;
  onHelp: () => void;
  logoutAccounts: { id: string; label: string; note?: string; logout: () => Promise<void> }[];
}

export function NavigationRail(p: Props) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const modifier = isMac() ? '⌘' : 'Ctrl';
  const close = (restore = true) => {
    setOpen(false);
    setHelpOpen(false);
    setLogoutOpen(false);
    if (restore) triggerRef.current?.focus();
  };
  const choose = (action: () => void) => {
    close();
    action();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger || !menu) return;
      setPosition({
        left: Math.max(8, Math.min(trigger.right + 8, window.innerWidth - menu.width - 8)),
        top: Math.max(8, Math.min(trigger.bottom, window.innerHeight - 8) - menu.height),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, helpOpen, logoutOpen, error, p.logoutAccounts.length]);

  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (error && !loggingOut) menuRef.current?.querySelector<HTMLButtonElement>('[data-logout]')?.focus();
  }, [error, loggingOut]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close(false);
    };
    const onFocus = (event: FocusEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const avatar = <span className="avatar">{p.userName === 'Account' ? <UserIcon /> : initials(p.userName)}</span>;
  const planLabel = p.subscriptionCount === 0 ? 'No accounts connected' : `${p.subscriptionCount} account${p.subscriptionCount === 1 ? '' : 's'} connected`;

  return (
    <nav className="navigation-rail" aria-label="Main navigation">
      <div className="rail-top">
        <button className={`rail-button${p.homeActive ? ' selected' : ''}`} aria-label="Home" aria-current={p.homeActive ? 'page' : undefined} title="Home" onClick={p.onHome} onMouseEnter={() => p.onHomeHover?.(true)} onMouseLeave={() => p.onHomeHover?.(false)}><HomeIcon /></button>
        <button className={`rail-button${p.historyOpen ? ' selected' : ''}`} aria-label="Chat history" aria-expanded={p.historyOpen} aria-controls="chat-history" title="Chat history" onClick={p.onToggleHistory}><ChatsIcon /></button>
        <button className={`rail-button rail-scheduled${p.scheduledActive ? ' selected' : ''}`} aria-label="Scheduled tasks" aria-current={p.scheduledActive ? 'page' : undefined} title="Scheduled" onClick={p.onScheduled}><HistoryIcon /></button>
      </div>
      <div className="rail-bottom">
        <button className="rail-button" aria-label="Settings" title={`Settings (${modifier},)`} onClick={p.onSettings}><GearIcon /></button>
        <button
          ref={triggerRef}
          className={`rail-button profile-btn${open ? ' selected' : ''}`}
          aria-label="Profile menu"
          title={p.userName}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'profile-menu' : undefined}
          onClick={() => {
            if (open) close();
            else { setError(''); setOpen(true); }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >{avatar}</button>
      </div>
      {open && createPortal(
        <div
          id="profile-menu"
          className="profile-menu"
          role="menu"
          aria-label="Account"
          ref={menuRef}
          style={position}
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown') items[(current + 1) % items.length]?.focus();
            else if (event.key === 'ArrowUp') items[(current - 1 + items.length) % items.length]?.focus();
            else if (event.key === 'Home') items[0]?.focus();
            else if (event.key === 'End') items.at(-1)?.focus();
            else if (event.key === 'ArrowRight' && (event.target as HTMLElement).hasAttribute('data-help')) {
              setHelpOpen(true);
              setLogoutOpen(false);
            } else if (event.key === 'ArrowRight' && (event.target as HTMLElement).hasAttribute('data-logout')) {
              setLogoutOpen(true);
              setHelpOpen(false);
            }
            else if (event.key === 'ArrowLeft' && helpOpen) {
              setHelpOpen(false);
              menuRef.current?.querySelector<HTMLButtonElement>('[data-help]')?.focus();
            } else if (event.key === 'ArrowLeft' && logoutOpen) {
              setLogoutOpen(false);
              menuRef.current?.querySelector<HTMLButtonElement>('[data-logout]')?.focus();
            } else if (event.key === 'Escape') close();
            else if (event.key === 'Tab') { close(); return; }
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="profile-menu-identity">
            {avatar}
            <div className="profile-text">
              <span className="profile-name" title={p.userName}>{p.userName}</span>
              <span className="profile-plan">{planLabel}</span>
            </div>
          </div>
          <div className="profile-menu-divider" role="separator" />
          <button className="profile-menu-item" role="menuitem" onClick={() => choose(p.onSettings)}><GearIcon /><span>Settings</span><kbd>{modifier},</kbd></button>
          <button className="profile-menu-item" role="menuitem" data-help aria-haspopup="menu" aria-expanded={helpOpen} onClick={() => { setHelpOpen((value) => !value); setLogoutOpen(false); }}><HelpIcon /><span>Help</span><ChevronRightIcon /></button>
          {helpOpen && <div className="profile-help-menu" role="menu" aria-label="Help"><button autoFocus className="profile-menu-item" role="menuitem" onClick={() => choose(p.onHelp)}>Keyboard shortcuts</button></div>}
          {p.logoutAccounts.length > 0 && <>
            <div className="profile-menu-divider" role="separator" />
            <button className="profile-menu-item" role="menuitem" data-logout aria-haspopup="menu" aria-expanded={logoutOpen} disabled={loggingOut} onClick={() => { setLogoutOpen((value) => !value); setHelpOpen(false); }}><LogOutIcon /><span>Log out</span><ChevronRightIcon /></button>
            {logoutOpen && <div className="profile-help-menu" role="menu" aria-label="Log out">
              {p.logoutAccounts.map((account, index) => <button key={account.id} autoFocus={index === 0} className="profile-menu-item" role="menuitem" disabled={loggingOut} onClick={async () => {
                setLoggingOut(true);
                setError('');
                try { await account.logout(); close(); }
                catch { setError(`Could not log out of ${account.label}. Try again in Settings.`); }
                finally { setLoggingOut(false); }
              }}><span>{loggingOut ? 'Logging out…' : account.label}{account.note && <small>{account.note}</small>}</span></button>)}
            </div>}
          </>}
          {error && <p className="profile-menu-error" role="alert">{error}</p>}
        </div>,
        document.body,
      )}
    </nav>
  );
}
