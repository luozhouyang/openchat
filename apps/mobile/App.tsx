import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Button,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Message } from "protocol";
import { api, signIn } from "./src/lib/auth";
import { consumeDeepLink, registerPush } from "./src/lib/push";
import { hydrateChannel, persistMessage, persistMessages } from "./src/lib/message-db";
import { createMobilePlatform } from "./src/platform";
import { useMessages } from "./src/stores/messages";
import { closeRealtime, connectRealtime, onConnectionState, sendFrame } from "./src/ws/client";

type TeamSummary = { id: string; displayName: string; channels: ChannelSummary[] };
type ChannelSummary = { id: string; displayName: string; type: string; member?: unknown };
type Route =
  | { screen: "workspace" }
  | { screen: "channel"; teamId: string; channelId: string; title: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ screen: "workspace" });
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    if (hasSession !== true) return;
    // Notification tap deep link (openchat://c/<channelId>) → jump to channel.
    const link = consumeDeepLink();
    const channelId = link?.match(/^openchat:\/\/c\/(.+)$/)?.[1];
    if (channelId) setRoute({ screen: "channel", teamId: "", channelId, title: "# 频道" });
  }, [hasSession]);

  useEffect(() => {
    (async () => {
      try {
        await api("/api/v1/users/me/workspaces");
        setHasSession(true);
      } catch {
        setHasSession(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    void connectRealtime();
    void registerPush();
    const offState = onConnectionState(() => {});
    const mobilePlatform = createMobilePlatform();
    // Background closes the socket; foreground reconnects + re-syncs (spec §4.1).
    const offApp = mobilePlatform.onAppStateChange((state) => {
      if (state === "background") closeRealtime();
      else void connectRealtime();
    });
    return () => {
      offState();
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
  if (!hasSession) return <LoginScreen onLoggedIn={() => setHasSession(true)} />;

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
      await signIn(email.trim(), password);
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
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ teams: TeamSummary[] }>("/api/v1/users/me/workspaces");
        setTeams(res.teams);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
        setTeams([]);
      }
    })();
  }, []);

  if (teams === null) {
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
      <Text style={styles.header}>频道</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.channel.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Button
              title={`# ${item.channel.displayName} (${item.teamName})`}
              onPress={() =>
                onOpenChannel(item.teamId, item.channel.id, `# ${item.channel.displayName}`)
              }
            />
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>尚未加入任何频道</Text>}
      />
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
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
    void hydrateChannel(channelId, (rows) => {
      useMessages.getState().applySync(channelId, rows);
      refresh();
    });
    // 2) …then REST history fills anything the cache missed.
    void (async () => {
      try {
        const res = await api<{ messages: Message[] }>(
          `/api/v1/channels/${channelId}/posts?limit=30`,
        );
        useMessages.getState().applySync(channelId, res.messages);
        void persistMessages(channelId, res.messages);
        refresh();
      } catch {
        // offline: keep showing cached rows
      }
    })();
    // 3) re-render on every store change for this channel
    return useMessages.subscribe((state) => {
      if (state.channels[channelId]) refresh();
    });
  }, [channelId, refresh]);

  // Mark read whenever the channel head advances.
  useEffect(() => {
    if (maxSeq > 0) {
      sendFrame({ type: "mark_read", channelId, seq: maxSeq });
    }
  }, [channelId, maxSeq]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content) return;
    const clientToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const max = useMessages.getState().maxSeq(channelId);
    useMessages.getState().ingest(channelId, {
      id: `pending-${clientToken}`,
      seq: max + 1,
      userId: "me",
      parentId: null,
      type: "text",
      content,
      attachments: null,
      mentions: null,
      editedAt: null,
      deletedAt: null,
      createdAt: Date.now(),
    });
    setDraft("");
    refresh();
    try {
      const posted = await api<Message>(`/api/v1/channels/${channelId}/posts`, {
        method: "POST",
        body: JSON.stringify({ message: content, clientToken }),
      });
      useMessages.getState().ack(channelId, clientToken, { id: posted.id, seq: posted.seq });
      void persistMessage(channelId, posted);
      refresh();
    } catch {
      useMessages.getState().fail(channelId, clientToken);
      setDraft(content);
      refresh();
    }
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
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  row: { paddingHorizontal: 8, paddingVertical: 2 },
  error: { color: "#c0392b", paddingHorizontal: 12 },
  empty: { color: "#888", padding: 12 },
  message: { paddingHorizontal: 12, paddingVertical: 6 },
  messageUser: { fontSize: 12, color: "#666" },
  composer: { flexDirection: "row", gap: 8, padding: 8 },
  footnote: { fontSize: 10, color: "#bbb", textAlign: "center", paddingBottom: 4 },
});
