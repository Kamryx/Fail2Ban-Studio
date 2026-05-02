export const KNOWN_JAILS = {
  sshd: {
    title: "SSH Daemon",
    description: "Protects your Unraid host SSH service against repeated failed logins.",
    targetHint: "host",
    tags: ["Host", "Authentication"]
  },
  "nginx-http-auth": {
    title: "Nginx HTTP Auth",
    description: "Watches nginx auth prompts and bans repeated credential failures.",
    targetHint: "docker",
    tags: ["Reverse Proxy", "Authentication"]
  },
  "nginx-badbots": {
    title: "Nginx Bad Bots",
    description: "Blocks noisy crawlers and scanners that identify themselves as known bots.",
    targetHint: "docker",
    tags: ["Reverse Proxy", "Bots"]
  },
  "nginx-botsearch": {
    title: "Nginx Bot Search",
    description: "Catches requests probing for suspicious paths and common web exploits.",
    targetHint: "docker",
    tags: ["Reverse Proxy", "Probing"]
  },
  "nginx-limit-req": {
    title: "Nginx Rate Limits",
    description: "Uses nginx limit_req logging to respond to high-rate request bursts.",
    targetHint: "docker",
    tags: ["Reverse Proxy", "Rate Limit"]
  },
  "nginx-bad-request": {
    title: "Nginx Bad Requests",
    description: "Tracks malformed client requests in nginx access logs.",
    targetHint: "docker",
    tags: ["Reverse Proxy", "Requests"]
  },
  "nginx-forbidden": {
    title: "Nginx Forbidden",
    description: "Bans clients repeatedly hitting paths that nginx denies.",
    targetHint: "docker",
    tags: ["Reverse Proxy", "Probing"]
  },
  "apache-auth": {
    title: "Apache Auth",
    description: "Protects Apache HTTP auth prompts from brute-force attempts.",
    targetHint: "docker",
    tags: ["Web", "Authentication"]
  },
  "apache-badbots": {
    title: "Apache Bad Bots",
    description: "Targets noisy crawlers and spammy user agents in Apache logs.",
    targetHint: "docker",
    tags: ["Web", "Bots"]
  },
  "apache-botsearch": {
    title: "Apache Bot Search",
    description: "Responds to exploit probes and suspicious path discovery in Apache.",
    targetHint: "docker",
    tags: ["Web", "Probing"]
  },
  "php-url-fopen": {
    title: "PHP URL Fopen Abuse",
    description: "Looks for PHP URL-fopen attack patterns in web server logs.",
    targetHint: "docker",
    tags: ["Web", "PHP"]
  },
  recidive: {
    title: "Repeat Offenders",
    description: "Extends bans for IPs that keep triggering shorter jails.",
    targetHint: "docker",
    tags: ["Escalation", "Repeat Abuse"]
  }
};

export const COMMON_IGNORE_IPS = [
  "127.0.0.1/8",
  "::1",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16"
];

const STARTER_JAIL_ORDER = [
  "sshd",
  "nginx-http-auth",
  "nginx-badbots",
  "nginx-botsearch",
  "apache-auth",
  "apache-badbots"
];

export function getKnownJailNames() {
  return Object.keys(KNOWN_JAILS);
}

export function describeJail(name) {
  return (
    KNOWN_JAILS[name] ?? {
      title: name,
      description: "Custom or image-provided jail.",
      targetHint: "docker",
      tags: ["Custom"]
    }
  );
}

export function createStarterJails(availableJails = []) {
  const available = new Set(availableJails);
  const picks = STARTER_JAIL_ORDER.filter((name) => available.size === 0 || available.has(name));

  return picks.map((name) => {
    const details = describeJail(name);
    return {
      id: `starter-${name}`,
      name,
      source: "preset",
      enabled: name === "sshd",
      target: details.targetHint,
      chain: details.targetHint === "host" ? "INPUT" : "DOCKER-USER",
      action: "%(known/action)s",
      port: "",
      filter: "",
      logpath: "",
      backend: "",
      banaction: "",
      mode: "",
      maxretry: "",
      findtime: "",
      bantime: "",
      notes: ""
    };
  });
}

export function listAvailableChoices(availableJails = []) {
  const merged = new Set([...availableJails, ...getKnownJailNames()]);

  return [...merged]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      name,
      ...describeJail(name)
    }));
}
