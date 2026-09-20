# Security policy

Please report security issues privately through GitHub's security advisory workflow rather than opening a public issue.

Tab Navigator is intentionally limited to client-side URL replacement inside the configured `base_path`. It does not call Home Assistant services, mutate entities, target devices automatically, or send data to a remote service.
