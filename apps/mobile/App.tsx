import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Button,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NotificationItem } from "protocol";
import type { StoreMessage } from "state";
import { useSidebarStore, useTeamsStore } from "state";
import { appClient } from "./src/app-client";
import { consumeDeepLink, registerPush } from "./src/lib/push";

import { createMobilePlatform } from "./src/platform";
import { notificationLabel } from "./src/lib/notifications";
import { useMessages } from "./src/stores/messages";
import { closeRealtime, connectRealtime, sendActivity, sendFrame } from "./src/ws/client";

type Route =
  | { screen: "workspace" }
  | { screen: "channel"; teamId: string; channelId: string; title: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ screen: "workspace" });
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    if (hasSession !== true) {
      return;
    }
    // Notification tap deep link (openchat://c/<channelId>) → jump to channel.
    const link = consumeDeepLink();
    const channelId = link?.match(/^openchat:\/\/c\/(.+)$/)?.[1];
    if (channelId) {
      setRoute({ screen: "channel", teamId: "", channelId, title: "# 频道" });
    }
  }, [hasSession]);

  useEffect(() => {
    (async () => {
      try {
        await appClient.auth.hasSession();
        setHasSession(true);
      } catch {
        setHasSession(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hasSession) {
      return;
    }
    void connectRealtime();
    void registerPush();
    sendActivity(); // foregrounding is an interaction signal
    const mobilePlatform = createMobilePlatform();
    // Background closes the socket; foreground reconnects + re-syncs (spec §4.1).
    const offApp = mobilePlatform.onAppStateChange((state) => {
      if (state === "background") {
        closeRealtime();
      } else {
        void connectRealtime();
        sendActivity();
      }
    });
    return () => {
      offApp();
      closeRealtime();
    };
  }, [hasSession]);

  if (hasSession === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!hasSession) {
    return <LoginScreen onLoggedIn={() => setHasSession(true)} />;
  }

  return (
    <View style={styles.app}>
      {route.screen === "workspace" ? (
        <WorkspaceScreen
          onOpenChannel={(teamId, channelId, title) =>
            setRoute({ screen: "channel", teamId, channelId, title })
          }
        />
      ) : (
        <ChannelScreen
          key={route.channelId}
          teamId={route.teamId}
          channelId={route.channelId}
          title={route.title}
          onBack={() => setRoute({ screen: "workspace" })}
        />
      )}
    </View>
  );
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await appClient.auth.signIn(email.trim(), password);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }, [email, password, onLoggedIn]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <View style={[styles.flex, styles.center, styles.pad]}>
        <Text style={styles.title}>登录 openchat</Text>
        <TextInput
          style={styles.input}
          placeholder="邮箱"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          testID="login-email"
        />
        <TextInput
          style={styles.input}
          placeholder="密码"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          testID="login-password"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {busy ? <ActivityIndicator /> : <Button title="登录" onPress={() => void submit()} />}
      </View>
    </KeyboardAvoidingView>
  );
}

function WorkspaceScreen({
  onOpenChannel,
}: {
  onOpenChannel: (teamId: string, channelId: string, title: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const teams = useTeamsStore((s) => s.teams);
  const loaded = useTeamsStore((s) => s.loaded);
  const unread = notifications.filter((item) => item.readAt === null).length;

  const loadInbox = useCallback(async () => {
    try {
      const res = await appClient.api.notifications.list(50);
      setNotifications(res.notifications);
    } catch {
      // offline: keep the last snapshot
    }
  }, []);

  useEffect(() => {
    void loadInbox();
    const timer = setInterval(() => void loadInbox(), 60_000);
    return () => clearInterval(timer);
  }, [loadInbox]);

  async function openNotification(item: NotificationItem) {
    setInboxOpen(false);
    if (item.readAt === null) {
      setNotifications((rows) =>
        rows.map((row) => (row.id === item.id ? { ...row, readAt: Date.now() } : row)),
      );
      void appClient.api.notifications.markRead([item.id]).catch(() => {});
    }
    try {
      const detail = await appClient.api.channels.get(item.channelId);
      onOpenChannel(detail.channel.teamId ?? "", item.channelId, `# ${detail.channel.displayName}`);
    } catch {
      // the channel may have been deleted since the notification
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await appClient.api.workspaces();
        useTeamsStore.getState().loadAll(res);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      }
    })();
    // Live updates arrive via the resident realtime connection's dispatcher.
  }, []);

  // Sidebar counts (unread/mentions) come from the shared store: seeded via
  // REST here, then kept live by sidebar.update / channel.read WS events.
  useEffect(() => {
    void (async () => {
      try {
        const res = await appClient.api.sidebar();
        useSidebarStore.getState().loadAll(res.channels);
      } catch {
        // offline: badges resume from live events
      }
    })();
  }, []);

  if (!loaded && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const rows = teams.flatMap((team) =>
    team.channels
      .filter((c) => c.type === "public" || c.type === "private")
      .map((channel) => ({ teamId: team.id, teamName: team.displayName, channel })),
  );

  return (
    <View style={styles.flex}>
      <View style={styles.workspaceHeader}>
        <Text style={styles.header}>频道</Text>
        <Button
          title={unread > 0 ? `通知 (${unread})` : "通知"}
          onPress={() => setInboxOpen(true)}
          testID="open-inbox"
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.channel.id}
        renderItem={({ item }) => (
          <SidebarRow
            label={`# ${item.channel.displayName}`}
            teamName={item.teamName}
            channelId={item.channel.id}
            onOpen={() =>
              onOpenChannel(item.teamId, item.channel.id, `# ${item.channel.displayName}`)
            }
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>尚未加入任何频道</Text>}
      />
      <Modal visible={inboxOpen} animationType="slide" onRequestClose={() => setInboxOpen(false)}>
        <View style={styles.flex}>
          <View style={styles.workspaceHeader}>
            <Button title="关闭" onPress={() => setInboxOpen(false)} />
            <Text style={styles.header}>通知</Text>
          </View>
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => void openNotification(item)}
                style={styles.message}
                testID={`notification-${item.id}`}
              >
                <Text style={styles.messageUser}>{notificationLabel(item.kind)}</Text>
                <Text numberOfLines={2}>{item.preview}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>暂无通知</Text>}
          />
        </View>
      </Modal>
    </View>
  );
}

function SidebarRow({
  label,
  teamName,
  channelId,
  onOpen,
}: {
  label: string;
  teamName: string;
  channelId: string;
  onOpen: () => void;
}) {
  const entry = useSidebarStore((s) => s.entries[channelId]);
  const unread = entry?.unread ?? 0;
  const mentions = entry?.mentions ?? 0;
  return (
    <View style={styles.row}>
      <Button title={`${label} (${teamName})`} onPress={onOpen} />
      {mentions > 0 ? (
        <View style={styles.mentionBadge}>
          <Text style={styles.mentionBadgeText}>@{mentions}</Text>
        </View>
      ) : unread > 0 ? (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ChannelScreen({
  channelId,
  teamId,
  title,
  onBack,
}: {
  channelId: string;
  teamId: string;
  title: string;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<StoreMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const maxSeq = useMessages((s) => s.maxSeq(channelId));

  const refresh = useCallback(() => {
    setMessages(
      useMessages
        .getState()
        .list(channelId)
        .filter((m) => !m.deletedAt),
    );
  }, [channelId]);

  // 1) hydrate from the on-device DB (instant, offline-capable)…
  useEffect(() => {
    useMessages.getState().reset(channelId);
    setHasOlder(true);
    void appClient.channels.hydrate(channelId).then(refresh);
    // 2) …then REST history fills anything the cache missed.
    void (async () => {
      try {
        const res = await appClient.api.posts.list(channelId, { limit: 30 });
        await appClient.channels.applyHistory(channelId, res.messages);
        refresh();
      } catch {
        // offline: keep showing cached rows
      }
    })();
    // 3) re-render on every store change for this channel
    return useMessages.subscribe((state) => {
      if (state.channels[channelId]) {
        refresh();
      }
    });
  }, [channelId, refresh]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder) {
      return;
    }
    const oldest = useMessages
      .getState()
      .list(channelId)
      .find((m) => m.seq > 0)?.seq;
    if (oldest === undefined || oldest <= 1) {
      setHasOlder(false);
      return;
    }
    setLoadingOlder(true);
    try {
      const mayHaveMore = await appClient.channels.loadOlder(channelId);
      refresh();
      if (!mayHaveMore) {
        setHasOlder(false);
      }
    } catch {
      // offline: keep what we have
    } finally {
      setLoadingOlder(false);
    }
  }, [channelId, hasOlder, loadingOlder, refresh]);

  // Mark read whenever the channel head advances.
  useEffect(() => {
    if (maxSeq > 0) {
      useSidebarStore.getState().markRead(channelId);
      sendFrame({ type: "mark_read", channelId, seq: maxSeq });
    }
  }, [channelId, maxSeq]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content) {
      return;
    }
    const clientToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setDraft("");
    refresh();
    sendActivity(); // sending is an interaction signal
    const ok = await appClient.messages.send(channelId, content, clientToken);
    if (!ok) {
      setDraft(content);
    } // failed send restores the draft
    refresh();
  }, [channelId, draft, refresh]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <View style={styles.channelHeader}>
        <Button title="←" onPress={onBack} />
        <Text style={styles.header}>{title}</Text>
      </View>
      <FlatList
        style={styles.flex}
        data={messages}
        keyExtractor={(m) => m.id}
        ListHeaderComponent={
          hasOlder ? (
            <Button
              title={loadingOlder ? "加载中…" : "加载更早的消息"}
              onPress={() => void loadOlder()}
              testID="load-older"
            />
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.message} testID={`message-${item.id}`}>
            <Text style={styles.messageUser}>{item.userId || "me"}</Text>
            <Text>{item.content}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>暂无消息</Text>}
      />
      <View style={styles.composer}>
        <TextInput
          style={[styles.input, styles.flex]}
          placeholder="输入消息…"
          value={draft}
          onChangeText={setDraft}
          testID="composer-input"
        />
        <Button title="发送" onPress={() => void send()} testID="composer-send" />
      </View>
      <Text style={styles.footnote}>{teamId ? "" : ""}</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, paddingTop: Platform.OS === "android" ? 24 : 0 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  pad: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 8 },
  header: { fontSize: 17, fontWeight: "600", padding: 12 },
  channelHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  workspaceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  unreadBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 11,
    backgroundColor: "#6b7280",
    alignItems: "center",
  },
  unreadBadgeText: { color: "#fff", fontSize: 12 },
  mentionBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 11,
    backgroundColor: "#c0392b",
    alignItems: "center",
  },
  mentionBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  error: { color: "#c0392b", paddingHorizontal: 12 },
  empty: { color: "#888", padding: 12 },
  message: { paddingHorizontal: 12, paddingVertical: 6 },
  messageUser: { fontSize: 12, color: "#666" },
  composer: { flexDirection: "row", gap: 8, padding: 8 },
  footnote: { fontSize: 10, color: "#bbb", textAlign: "center", paddingBottom: 4 },
});
