import React, { useEffect, useState } from 'react';
import { Panel, Empty, RecordList } from './Common';

import { useLocalization } from '../../i18n/Localization';
import { parseCSV } from '../../utils/importCSV';

async function request(url: string, method = 'GET', body?: any) {
  const upper=method.toUpperCase();
  const unsafe=!['GET','HEAD','OPTIONS'].includes(upper);
  let csrf='';
  if(unsafe){
    const auth=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
    const session=await auth.json().catch(()=>({}));
    if(!auth.ok||typeof session.csrf!=='string'||!session.csrf)
      throw Error('Session verification unavailable. Refresh and sign in again.');
    csrf=session.csrf;
  }
  const r = await fetch(url, {
    method:upper,
    credentials:'same-origin',
    headers: body
      ? { 'Content-Type': 'application/json', ...(unsafe?{'x-csrf-token':csrf}:{}) }
      : unsafe ? {'x-csrf-token':csrf} : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw Error(data.error || 'Request failed.');
  return data;
}
const displayError = (error: any) =>
  error instanceof Error ? error.message : 'Unable to complete the request.';
function saveFile(name: string, value: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function HistoricalPrediction() {
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () =>
    request('/api/platform/prediction')
      .then(setData)
      .catch((e) => setMsg(displayError(e)));
  useEffect(() => {
    reload();
  }, []);
  const upload = async (file: File | undefined, kind: string) => {
    if (!file) return;
    setBusy(true);
    try {
      const rows = parseCSV(await file.text());
      await request('/api/platform/prediction/import', 'POST', { kind, rows });
      setMsg(`Imported ${rows.length} ${kind} records.`);
      await reload();
    } catch (e) {
      setMsg(displayError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Historical student success model"
      detail="For advisor-led support only. No automatic eligibility or disciplinary decisions. Use performance features measured before the outcome, and import historical cohorts separately from current students."
    >
      <p className="campus-muted">
        Required columns: studentId, cohort (e.g. 202601), priorGpa (0–4),
        attendance (0–100), recentAverage (0–100), scoreTrend (-100–100),
        missingAssignments. Historical data also requires needsSupport (0 or 1,
        using the university’s consistently defined support outcome).
      </p>
      <div className="campus-filters">
        <label>
          Historical labeled CSV
          <input
            disabled={busy}
            type="file"
            accept=".csv"
            onChange={(e) => upload(e.target.files?.[0], 'historical')}
          />
        </label>
        <label>
          Current student features CSV
          <input
            disabled={busy}
            type="file"
            accept=".csv"
            onChange={(e) => upload(e.target.files?.[0], 'current')}
          />
        </label>
      </div>
      <div className="campus-actions">
        <button
          className="campus-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await request('/api/platform/prediction/train', 'POST', {});
              await reload();
              setMsg(
                'Model trained. Review the holdout results before using predictions.',
              );
            } catch (e) {
              setMsg(displayError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Train and validate model
        </button>
        <button
          className="campus-button secondary"
          onClick={() =>
            saveFile(
              'historical-support-template.csv',
              'studentId,cohort,priorGpa,attendance,recentAverage,scoreTrend,missingAssignments,needsSupport\n',
              'text/csv',
            )
          }
        >
          Download CSV template
        </button>
      </div>
      <p role="status">{msg}</p>
      {data && (
        <p>
          {data.historicalRows} historical records · {data.currentRows} current
          records
        </p>
      )}
      {data?.model && (
        <>
          <div className="campus-metrics">
            <div>
              <strong>{data.model.trainingSize}</strong>
              <span>Training records</span>
            </div>
            <div>
              <strong>{data.model.validationSize}</strong>
              <span>Newer-cohort holdout</span>
            </div>
            <div>
              <strong>{(data.model.metrics.recall * 100).toFixed(1)}%</strong>
              <span>Validation recall</span>
            </div>
          </div>
          <p className="campus-muted">
            Accuracy {(data.model.metrics.accuracy * 100).toFixed(1)}% · AUC{' '}
            {data.model.metrics.auc?.toFixed(3) ?? 'Unavailable'} · Brier score{' '}
            {data.model.metrics.brier.toFixed(3)} (lower is better). Held-out
            students are excluded from training. Model: {data.model.version}.
            These are validation results on your supplied data, not a guarantee
            of future performance.
          </p>
        </>
      )}
      <RecordList
        items={data?.predictions?.map((p: any) => ({
          ...p,
          id: p.studentId + ':' + p.cohort,
        }))}
        render={(p: any) => (
          <div className="campus-signal">
            <strong>{p.studentId}</strong>
            <progress max={1} value={p.probability} />
            <span>
              {(p.probability * 100).toFixed(1)}% support-outcome estimate
            </span>
          </div>
        )}
      />
    </Panel>
  );
}
function TranslationManager() {
  const [data, setData] = useState<any>(null);
  const [code, setCode] = useState('kpe');
  const [text, setText] = useState('{}');
  const [reviewer, setReviewer] = useState('');
  const [msg, setMsg] = useState('');
  const { reload: reloadLanguage } = useLocalization();
  const reload = () =>
    request('/api/localization/admin')
      .then(setData)
      .catch((e) => setMsg(displayError(e)));
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    if (data) {
      setText(
        JSON.stringify(
          data.packs[code]?.strings ||
            Object.fromEntries(Object.keys(data.catalog).map((k) => [k, ''])),
          null,
          2,
        ),
      );
      setReviewer(data.packs[code]?.reviewedBy || '');
    }
  }, [code, data]);
  return (
    <Panel
      title="Translation workspace"
      detail="Import or edit a translation dictionary, identify the language reviewer, then publish. Only complete, reviewed packs appear in the language picker. English remains the fallback for content outside the catalog."
    >
      <div className="campus-filters">
        <select
          aria-label="Translation language"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        >
          {data &&
            Object.entries(data.languages)
              .filter(([key]) => key !== 'en')
              .map(([key, name]) => (
                <option key={key} value={key}>
                  {String(name)}
                </option>
              ))}
        </select>
        <button
          className="campus-button secondary"
          onClick={() =>
            saveFile(
              'english-interface-catalog.json',
              JSON.stringify(data?.catalog || {}, null, 2),
            )
          }
        >
          Download English catalog
        </button>
        <label>
          Import dictionary
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
            }}
          />
        </label>
      </div>
      <label>
        Translation dictionary
        <textarea
          aria-label="Translation dictionary"
          style={{
            width: '100%',
            minHeight: 260,
            fontFamily: 'monospace',
            fontSize: 12,
          }}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label>
        Language reviewer
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
      </label>
      <div className="campus-actions">
        {[false, true].map((publish) => (
          <button
            key={String(publish)}
            className={'campus-button' + (!publish ? ' secondary' : '')}
            onClick={async () => {
              try {
                const result = await request('/api/localization/pack', 'PUT', {
                  code,
                  strings: JSON.parse(text),
                  publish,
                  reviewedBy: reviewer,
                });
                setMsg(
                  `${result.translated}/${result.total} strings saved${publish ? ' and published' : ''}.`,
                );
                reloadLanguage();
              } catch (e) {
                setMsg(displayError(e));
              }
            }}
          >
            {publish ? 'Publish reviewed pack' : 'Save draft'}
          </button>
        ))}
        <button
          className="campus-button secondary"
          onClick={async () => {
            try {
              const result = await request('/api/localization/draft', 'POST', {
                code,
              });
              setText(JSON.stringify(result.strings, null, 2));
              setMsg(
                'AI draft generated. A fluent reviewer must verify it before publication.',
              );
            } catch (e) {
              setMsg(displayError(e));
            }
          }}
        >
          Generate AI draft
        </button>
      </div>
      <p role="status">{msg}</p>
    </Panel>
  );
}
export function EncryptedBackups() {
  const [items, setItems] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [envelope, setEnvelope] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () =>
    request('/api/platform/backups')
      .then(setItems)
      .catch((e) => setMsg(displayError(e)));
  useEffect(() => {
    reload();
  }, []);
  return (
    <Panel
      title="Encrypted backups"
      detail="Snapshots are encrypted with an installation key kept on the persistent volume. S3 receives only encrypted data. Preserve a separate, access-controlled copy of the encryption key for disaster recovery."
    >
      <button
        className="campus-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await request('/api/platform/backups', 'POST', {});
            setMsg(result.cloud);
            reload();
          } catch (e) {
            setMsg(displayError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Create encrypted snapshot
      </button>
      <RecordList
        items={items}
        render={(s: any) => (
          <>
            <strong>{new Date(s.createdAt).toLocaleString()}</strong>
            <p>{s.cloud}</p>
            <a href={'/api/platform/backups/' + s.id}>
              Download encrypted snapshot
            </a>
            <p>SHA-256: {s.sha256}</p>
          </>
        )}
      />
      <details>
        <summary>Restore a snapshot</summary>
        <p className="campus-muted">
          Restore replaces operational records and platform settings. Current
          user accounts and active authentication are preserved. Preview the
          selected file first.
        </p>
        <input
          type="file"
          accept=".json"
          onChange={async (e) => {
            setPreview(null);
            setEnvelope(null);
            try {
              const file = e.target.files?.[0];
              if (!file) return;
              const value = JSON.parse(await file.text());
              setPreview(
                await request('/api/platform/backups/preview', 'POST', {
                  envelope: value,
                }),
              );
              setEnvelope(value);
            } catch (e) {
              setMsg(displayError(e));
            }
          }}
        />
        {preview && (
          <>
            <p>
              {preview.createdAt} · {preview.users} users · {preview.courses}{' '}
              courses · {preview.documents} documents
            </p>
            <label>
              Type RESTORE SNAPSHOT to confirm
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <button
              className="campus-button"
              disabled={confirmation !== 'RESTORE SNAPSHOT' || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await request('/api/platform/backups/restore', 'POST', {
                    envelope,
                    confirmation,
                  });
                  setMsg(
                    'Snapshot restored. Reload the portal to review records.',
                  );
                  setPreview(null);
                  setConfirmation('');
                } catch (e) {
                  setMsg(displayError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restore snapshot
            </button>
          </>
        )}
      </details>
      <p role="status">{msg}</p>
    </Panel>
  );
}
export function AccountCenter({ user }: any) {
  const [data, setData] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [audit, setAudit] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [activation, setActivation] = useState('');
  const isAdmin = user.role === 'super_admin';
  const reload = () => {
    if (isAdmin) {
      request('/api/platform/status')
        .then(setData)
        .catch((e) => setMsg(displayError(e)));
      request('/api/identity/accounts')
        .then(setAccounts)
        .catch(() => {});
      request('/api/identity/audit')
        .then(setAudit)
        .catch(() => {});
    }
  };
  useEffect(() => {
    reload();
  }, [isAdmin]);
  return (
    <div className="campus-workspace">
      <div className="campus-eyebrow">ACCOUNT & INTEGRATIONS</div>
      <h2>Your account and university connections</h2>
      <Panel title="Change password">
        <form
          className="campus-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const values = Object.fromEntries(new FormData(e.currentTarget));
            try {
              await request('/api/auth/change-password', 'POST', values);
              location.assign('/?portal=1');
            } catch (e) {
              setMsg(displayError(e));
            }
          }}
        >
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          <button className="campus-button">Change password</button>
        </form>
      </Panel>
      <Panel
        title="Browser push notifications"
        detail="Enable notifications on this device to receive alerts while the portal is closed. Notifications contain no student details."
      >
        <button
          className="campus-button"
          onClick={async () => {
            try {
              if (!('serviceWorker' in navigator) || !('PushManager' in window))
                throw Error(
                  'This browser does not support push notifications.',
                );
              if ((await Notification.requestPermission()) !== 'granted')
                throw Error('Notifications were not enabled.');
              const registration =
                await navigator.serviceWorker.register('/sw.js');
              const key = await request('/api/platform/push');
              const decoded = atob(
                key.publicKey.replace(/-/g, '+').replace(/_/g, '/'),
              );
              const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
              const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: bytes,
              });
              await request('/api/platform/push', 'POST', {
                subscription: subscription.toJSON(),
              });
              setMsg('Notifications enabled for this account and device.');
            } catch (e) {
              setMsg(displayError(e));
            }
          }}
        >
          Enable device notifications
        </button>
        <button
          className="campus-button secondary"
          onClick={async () => {
            try {
              await request('/api/platform/push', 'DELETE');
              const reg = await navigator.serviceWorker.getRegistration();
              await (await reg?.pushManager.getSubscription())?.unsubscribe();
              setMsg('Device notifications disabled.');
            } catch (e) {
              setMsg(displayError(e));
            }
          }}
        >
          Disable device notifications
        </button>
      </Panel>
      {isAdmin && (
        <>
          <Panel title="Account invitations">
            <form
              className="campus-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const result = await request(
                    '/api/identity/invite',
                    'POST',
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
                  setActivation(result.activationUrl);
                  reload();
                } catch (e) {
                  setMsg(displayError(e));
                }
              }}
            >
              <label>
                Name
                <input name="name" required />
              </label>
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Role
                <select name="role">
                  {[
                    'student',
                    'alumni',
                    'lecturer',
                    'dean',
                    'registrar',
                    'bursar',
                    'admissions_officer',
                    'super_admin',
                  ].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <button className="campus-button">Create invitation</button>
            </form>
            {activation && (
              <div className="campus-record">
                <p>
                  Private activation link · expires in 48 hours · usable once
                </p>
                <input
                  readOnly
                  aria-label="Account activation link"
                  value={activation}
                />
                <p className="campus-muted">
                  Share privately with the intended account owner.
                </p>
              </div>
            )}
            <RecordList
              items={accounts}
              render={(a: any) => (
                <>
                  <strong>{a.email}</strong>
                  <p>
                    {a.role} ·{' '}
                    {a.activated ? 'Activated' : 'Awaiting activation'} ·{' '}
                    {a.disabled ? 'Disabled' : 'Enabled'}
                  </p>
                  {a.id !== user.id && (
                    <form
                      className="campus-filters"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const values = Object.fromEntries(
                          new FormData(e.currentTarget),
                        );
                        try {
                          await request(
                            '/api/identity/accounts/' + a.id,
                            'PATCH',
                            {
                              role: values.role,
                              disabled: values.disabled === 'yes',
                            },
                          );
                          reload();
                          setMsg('Access updated; existing sessions revoked.');
                        } catch (e) {
                          setMsg(displayError(e));
                        }
                      }}
                    >
                      <select
                        name="role"
                        aria-label={'Role for ' + a.email}
                        defaultValue={a.role}
                      >
                        {[
                          'student',
                          'alumni',
                          'lecturer',
                          'dean',
                          'registrar',
                          'bursar',
                          'admissions_officer',
                          'super_admin',
                        ].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                      <select
                        name="disabled"
                        defaultValue={a.disabled ? 'yes' : 'no'}
                      >
                        <option value="no">Enabled</option>
                        <option value="yes">Disabled</option>
                      </select>
                      <button className="campus-button secondary">
                        Update access
                      </button>
                    </form>
                  )}
                </>
              )}
            />
          </Panel>
          <Panel
            title="Integration readiness"
            detail="Configure secret values in Coolify. This page shows configuration presence, never credentials."
          >
            <RecordList
              items={Object.entries(data?.providers || {}).map(
                ([id, v]: any) => ({ id, ...v }),
              )}
              render={(p: any) => (
                <>
                  <strong>
                    {p.provider} ·{' '}
                    {p.configured
                      ? 'Configured — verify delivery'
                      : 'Not connected'}
                  </strong>
                  <p>{p.required.join(', ')}</p>
                </>
              )}
            />
            <button
              className="campus-button secondary"
              onClick={async () => {
                try {
                  await request('/api/platform/test-email', 'POST', {});
                  setMsg(
                    'Email provider accepted the test message for your account address.',
                  );
                } catch (e) {
                  setMsg(displayError(e));
                }
              }}
            >
              Send test email to my account
            </button>
          </Panel>
          <TranslationManager />
          <EncryptedBackups />
          <Panel
            title="Security audit"
            detail="Chained hashes detect inconsistent edits to retained audit entries; an external checkpoint is required to detect a complete privileged rewrite."
          >
            <p>
              Audit chain: {audit?.intact ? 'Consistent' : 'Not yet verified'}
            </p>
            <RecordList
              items={audit?.entries}
              render={(a: any) => (
                <>
                  <strong>{a.action}</strong>
                  <p>
                    {a.actor} · {a.at}
                  </p>
                </>
              )}
            />
          </Panel>
        </>
      )}
      <p role="status" className="campus-status">
        {msg}
      </p>
    </div>
  );
}
