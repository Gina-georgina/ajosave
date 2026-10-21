"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { DeleteAccountButton } from "@/components/ui/DeleteAccountButton";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import styles from "./page.module.css";

interface SessionInfo {
  id: string;
  deviceName: string;
  deviceType: string;
  browser: string;
  os: string;
  ipAddress: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

interface ReminderPreferences {
  enabled: boolean;
  leadHours: number[];
  channels: string[];
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [reminderPreferences, setReminderPreferences] = useState<ReminderPreferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [smsSaving, setSmsSaving] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [revokingSession, setRevokingSession] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  useEffect(() => {
    if (session) {
      fetchSessions();
      fetchPreferences();
    }
  }, [session]);

  const fetchPreferences = async () => {
    setPreferencesLoading(true);
    setPreferencesError(null);
    try {
      const [profileResponse, reminderResponse] = await Promise.all([
        fetch("/api/v1/profile"),
        fetch("/api/user/reminder-preferences"),
      ]);
      const [profileJson, reminderJson] = await Promise.all([
        profileResponse.json(),
        reminderResponse.json(),
      ]);
      if (!profileResponse.ok || !profileJson.success) {
        throw new Error(profileJson.error ?? "Failed to load notification preferences");
      }
      if (!reminderResponse.ok || !reminderJson.success) {
        throw new Error(reminderJson.error ?? "Failed to load notification preferences");
      }
      setSmsEnabled(profileJson.data.smsNotificationsEnabled);
      setReminderPreferences(reminderJson.data);
    } catch (error) {
      setPreferencesError(error instanceof Error ? error.message : "Failed to load notification preferences");
    } finally {
      setPreferencesLoading(false);
    }
  };

  const fetchSessions = async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/v1/sessions");
      const json = await res.json();
      if (json.success) {
        setSessions(json.data.sessions);
      }
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSession(sessionId);
    setSessionMessage(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error);
      }
      setSessionMessage({ type: "success", text: "Session revoked successfully" });
      await fetchSessions();
    } catch (error) {
      setSessionMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to revoke session",
      });
    } finally {
      setRevokingSession(null);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!confirm("Are you sure you want to sign out all other devices? You will remain signed in on this device.")) {
      return;
    }
    setRevokingAll(true);
    setSessionMessage(null);
    try {
      const res = await fetch("/api/v1/sessions/revoke-all?keepCurrent=true", {
        method: "POST",
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error);
      }
      setSessionMessage({
        type: "success",
        text: `Signed out from ${json.data.revokedCount} device(s)`,
      });
      await fetchSessions();
    } catch (error) {
      setSessionMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to revoke sessions",
      });
    } finally {
      setRevokingAll(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType) {
      case "mobile":
        return "📱";
      case "tablet":
        return "📱";
      case "desktop":
        return "💻";
      default:
        return "🖥️";
    }
  };

  const handleToggleSms = async (enabled: boolean) => {
    const previousValue = smsEnabled;
    setSmsEnabled(enabled);
    setSmsSaving(true);
    try {
      const res = await fetch("/api/user/sms-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to update SMS preferences");
      toast(`SMS notifications ${enabled ? "enabled" : "disabled"}`, "success");
    } catch (error) {
      setSmsEnabled(previousValue);
      toast(error instanceof Error ? error.message : "Failed to update SMS preferences", "error");
    } finally {
      setSmsSaving(false);
    }
  };

  const handleToggleEmail = async (enabled: boolean) => {
    if (!reminderPreferences) return;
    const previousPreferences = reminderPreferences;
    const channels = enabled
      ? [...new Set([...previousPreferences.channels, "email"])]
      : previousPreferences.channels.filter((channel) => channel !== "email");
    const nextPreferences = {
      ...previousPreferences,
      channels,
      enabled: channels.length > 0 && previousPreferences.enabled,
    };
    setReminderPreferences(nextPreferences);
    setEmailSaving(true);
    try {
      const res = await fetch("/api/user/reminder-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPreferences),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to update email preferences");
      setReminderPreferences(json.data);
      toast(`Email reminders ${enabled ? "enabled" : "disabled"}`, "success");
    } catch (error) {
      setReminderPreferences(previousPreferences);
      toast(error instanceof Error ? error.message : "Failed to update email preferences", "error");
    } finally {
      setEmailSaving(false);
    }
  };

  if (!session) {
    return (
      <div className={styles.container}>
        <div className={styles.content}>
          <p>Please sign in to access settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Settings</h1>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Notification Preferences</h2>
          {preferencesLoading ? (
            <p role="status" aria-live="polite">Loading notification preferences...</p>
          ) : preferencesError ? (
            <div role="alert" className={`${styles.message} ${styles.error}`}>
              {preferencesError}
            </div>
          ) : (
            <>
          
          <div className={styles.settingItem}>
            <div className={styles.settingInfo}>
              <h3 className={styles.settingName}>SMS Reminders</h3>
              <p className={styles.settingDesc}>
                Receive text messages for payout reminders, contribution confirmations, 
                and important circle updates.
              </p>
            </div>
            
            <div className={styles.settingControl}>
              <Input
                type="checkbox"
                label="SMS notifications"
                checked={smsEnabled}
                onChange={(event) => handleToggleSms(event.target.checked)}
                disabled={smsSaving}
                aria-checked={smsEnabled}
              />
            </div>
          </div>

          <div className={styles.settingItem}>
            <div className={styles.settingInfo}>
              <h3 className={styles.settingName}>Email Notifications</h3>
              <p className={styles.settingDesc}>Receive email reminders about upcoming contributions and payouts.</p>
            </div>
            <div className={styles.settingControl}>
              <Input
                type="checkbox"
                label="Email notifications"
                checked={reminderPreferences?.channels.includes("email") ?? false}
                onChange={(event) => handleToggleEmail(event.target.checked)}
                disabled={emailSaving}
                aria-checked={reminderPreferences?.channels.includes("email") ?? false}
              />
            </div>
          </div>

          <div className={styles.notificationTypes}>
            <h4 className={styles.typesTitle}>You will receive SMS for:</h4>
            <ul className={styles.typesList}>
              <li>📱 Payout reminders (24 hours before your turn)</li>
              <li>💰 Payout confirmations (when any member receives payout)</li>
              <li>✅ Contribution confirmations (when your payment is verified)</li>
              <li>⚠️ Missed contribution alerts</li>
              <li>👥 Join request approvals/rejections (for private circles)</li>
            </ul>
          </div>
            </>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Active Sessions</h2>
          <p className={styles.settingDesc}>
            Manage devices where you&apos;re currently signed in. You can sign out from individual devices or all devices at once.
          </p>

          {sessionMessage && (
            <div className={`${styles.message} ${styles[sessionMessage.type]}`}>
              {sessionMessage.text}
            </div>
          )}

          {sessionsLoading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "#718096" }}>
              Loading sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "#718096" }}>
              No active sessions found.
            </div>
          ) : (
            <>
              <div style={{ marginTop: "1.5rem", marginBottom: "1rem" }}>
                {sessions.map((sess) => (
                  <div key={sess.id} className={styles.settingItem}>
                    <div className={styles.settingInfo}>
                      <h3 className={styles.settingName}>
                        {getDeviceIcon(sess.deviceType)} {sess.deviceName}
                        {sess.isCurrent && (
                          <span
                            style={{
                              marginLeft: "0.5rem",
                              fontSize: "0.75rem",
                              padding: "0.25rem 0.5rem",
                              background: "#48bb78",
                              color: "white",
                              borderRadius: "4px",
                              fontWeight: "600",
                            }}
                          >
                            Current
                          </span>
                        )}
                      </h3>
                      <p className={styles.settingDesc}>
                        IP: {sess.ipAddress} • Last active: {formatDate(sess.lastActiveAt)}
                        <br />
                        Signed in: {formatDate(sess.createdAt)}
                      </p>
                    </div>
                    <div className={styles.settingControl}>
                      {!sess.isCurrent && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRevokeSession(sess.id)}
                          loading={revokingSession === sess.id}
                          disabled={revokingSession !== null}
                        >
                          Sign Out
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {sessions.length > 1 && (
                <div style={{ marginTop: "1.5rem" }}>
                  <Button
                    variant="secondary"
                    onClick={handleRevokeAllSessions}
                    loading={revokingAll}
                    disabled={revokingAll}
                  >
                    Sign Out All Other Devices
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Account Information</h2>
          
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Phone</span>
              <span className={styles.infoValue}>{session.user?.phone || "Not set"}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Display Name</span>
              <span className={styles.infoValue}>{session.user?.name || "Not set"}</span>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Danger Zone</h2>
          <p className={styles.settingDesc}>Permanently delete your account and all data.</p>
          <div style={{ marginTop: "var(--space-4)" }}>
            <DeleteAccountButton />
          </div>
        </section>
      </div>
    </div>
  );
}
