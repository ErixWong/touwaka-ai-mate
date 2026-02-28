# Firejail profile for admin
# Restrictions: minimal - full project access

# Full access to project
private ${PROJECT_ROOT}

# Higher resource limits
rlimit-as 2G
rlimit-nproc 200

# Network
netfilter

# Basic security (less restrictive)
seccomp