import { useEffect, useState } from 'react';
import { store, useStore, type Screen } from './state/store';
import { ipc } from './ipc/bridge';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import { DeviceScanScreen } from './screens/DeviceScanScreen';
import { KilterDetectionScreen } from './screens/KilterDetectionScreen';
import { StrategiesScreen } from './screens/StrategiesScreen';
import { FindingsScreen } from './screens/FindingsScreen';
import { ExportScreen } from './screens/ExportScreen';
import { DiagnosticsScreen } from './screens/DiagnosticsScreen';
import { BoardsScreen } from './screens/BoardsScreen';
import { ClimbsScreen } from './screens/ClimbsScreen';
import { ClimbDetailScreen } from './screens/ClimbDetailScreen';
import { IosComingSoonScreen } from './screens/IosComingSoonScreen';

interface NavItem { id: Screen; label: string; }
interface NavSection { title: string; items: NavItem[]; }
interface NavBranch {
  id: string;
  label: string;
  badge?: string;
  sections: NavSection[];
}

const NAV: NavBranch[] = [
  {
    id: 'android',
    label: 'Android',
    sections: [
      {
        title: 'Recovery',
        items: [
          { id: 'welcome',     label: 'Welcome' },
          { id: 'connect',     label: 'Connect' },
          { id: 'device',      label: 'Device' },
          { id: 'kilter',      label: 'Kilter detection' },
          { id: 'strategies',  label: 'Strategies' },
          { id: 'findings',    label: 'Findings' },
          { id: 'export',      label: 'Export' }
        ]
      },
      {
        title: 'Catalog',
        items: [
          { id: 'boards',       label: 'Boards' },
          { id: 'climbs',       label: 'Climbs' },
          { id: 'climb-detail', label: 'Climb detail' }
        ]
      },
      {
        title: 'Tools',
        items: [
          { id: 'diagnostics', label: 'Diagnostics' }
        ]
      }
    ]
  },
  {
    id: 'ios',
    label: 'iOS',
    badge: 'soon',
    sections: [
      {
        title: '',
        items: [
          { id: 'ios-coming-soon', label: 'Coming soon' }
        ]
      }
    ]
  }
];

const SCREEN_TO_BRANCH: Record<Screen, string> = {
  welcome:         'android',
  connect:         'android',
  device:          'android',
  kilter:          'android',
  strategies:      'android',
  findings:        'android',
  export:          'android',
  diagnostics:     'android',
  boards:          'android',
  climbs:          'android',
  'climb-detail':  'android',
  'ios-coming-soon': 'ios'
};

export default function App() {
  const screen = useStore((s) => s.screen);
  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>(() => ({
    android: true,
    ios: false
  }));

  // Auto-expand the branch that matches the active screen.
  useEffect(() => {
    const branch = SCREEN_TO_BRANCH[screen];
    if (branch && !openBranches[branch]) {
      setOpenBranches((prev) => ({ ...prev, [branch]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  useEffect(() => {
    const offProgress = ipc().events.onSessionProgress(({ message }) => {
      store.set((s) => ({ progress: [...s.progress.slice(-200), message] }));
    });
    const offLog = ipc().events.onLog((entry) => {
      store.set((s) => ({ logs: [...s.logs.slice(-1000), entry] }));
    });
    return () => { offProgress(); offLog(); };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Kilter <span>Recovery Kit</span></h1>
        {NAV.map((branch) => {
          const isOpen = openBranches[branch.id];
          const branchActive = SCREEN_TO_BRANCH[screen] === branch.id;
          return (
            <div className="nav-branch" key={branch.id}>
              <button
                className={`nav-branch-header${branchActive ? ' active' : ''}`}
                onClick={() => setOpenBranches((p) => ({ ...p, [branch.id]: !p[branch.id] }))}
              >
                <span className={`nav-branch-chevron${isOpen ? ' open' : ''}`}>▸</span>
                <span className="nav-branch-label">{branch.label}</span>
                {branch.badge && <span className="nav-branch-badge">{branch.badge}</span>}
              </button>
              {isOpen && (
                <div className="nav-branch-body">
                  {branch.sections.map((section, si) => (
                    <div className="nav-section" key={section.title || `s${si}`}>
                      {section.title && <div className="nav-section-title">{section.title}</div>}
                      {section.items.map((item) => (
                        <button
                          key={item.id}
                          className={`nav-item${screen === item.id ? ' active' : ''}`}
                          onClick={() => store.set({ screen: item.id })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </aside>
      <main className="main">
        {screen === 'welcome' && <WelcomeScreen />}
        {screen === 'connect' && <ConnectScreen />}
        {screen === 'device' && <DeviceScanScreen />}
        {screen === 'kilter' && <KilterDetectionScreen />}
        {screen === 'strategies' && <StrategiesScreen />}
        {screen === 'findings' && <FindingsScreen />}
        {screen === 'export' && <ExportScreen />}
        {screen === 'diagnostics' && <DiagnosticsScreen />}
        {screen === 'boards' && <BoardsScreen />}
        {screen === 'climbs' && <ClimbsScreen />}
        {screen === 'climb-detail' && <ClimbDetailScreen />}
        {screen === 'ios-coming-soon' && <IosComingSoonScreen />}
      </main>
    </div>
  );
}
