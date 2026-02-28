# Firejail profile for regular users
# Restrictions: limited file access, read-only skills

# User work directory (read-write)
whitelist ${PROJECT_ROOT}/data/work/${USER_ID}

# Skills directory (read-only)
read-only ${PROJECT_ROOT}/skills

# Block sensitive files
blacklist ${PROJECT_ROOT}/.env
blacklist ${PROJECT_ROOT}/*.key
blacklist ${PROJECT_ROOT}/*.pem

# Block access to other users' directories
blacklist ${PROJECT_ROOT}/data/work/*

# Resource limits
rlimit-as 512M
rlimit-nproc 50

# Network (allow but filter)
netfilter

# Disable dangerous operations
seccomp
caps.drop all