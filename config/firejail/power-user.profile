# Firejail profile for power users
# Restrictions: can modify skills, but cannot access sensitive configs

# Skills directory (read-write)
whitelist ${PROJECT_ROOT}/skills

# User work directory (read-write)
whitelist ${PROJECT_ROOT}/data/work/${USER_ID}

# Block sensitive files
blacklist ${PROJECT_ROOT}/.env
blacklist ${PROJECT_ROOT}/*.key
blacklist ${PROJECT_ROOT}/*.pem

# Resource limits (higher than regular user)
rlimit-as 1G
rlimit-nproc 100

# Network (allow but filter)
netfilter

# Security
seccomp
caps.drop all