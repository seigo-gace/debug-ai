#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <netinet/in.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef LANDLOCK_CREATE_RULESET_VERSION
#define LANDLOCK_CREATE_RULESET_VERSION (1U << 0)
#endif
#ifndef LANDLOCK_RULE_PATH_BENEATH
#define LANDLOCK_RULE_PATH_BENEATH 1
#endif
#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#ifndef LANDLOCK_ACCESS_NET_BIND_TCP
#define LANDLOCK_ACCESS_NET_BIND_TCP (1ULL << 0)
#define LANDLOCK_ACCESS_NET_CONNECT_TCP (1ULL << 1)
#endif
#ifndef SYS_landlock_create_ruleset
#define SYS_landlock_create_ruleset 444
#define SYS_landlock_add_rule 445
#define SYS_landlock_restrict_self 446
#endif
#ifndef SOCK_TYPE_MASK
#define SOCK_TYPE_MASK 0xf
#endif

struct debugai_ruleset_attr { uint64_t handled_access_fs; uint64_t handled_access_net; };
static const uint64_t FS_BASE = LANDLOCK_ACCESS_FS_EXECUTE|LANDLOCK_ACCESS_FS_WRITE_FILE|LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_READ_DIR|LANDLOCK_ACCESS_FS_REMOVE_DIR|LANDLOCK_ACCESS_FS_REMOVE_FILE|LANDLOCK_ACCESS_FS_MAKE_CHAR|LANDLOCK_ACCESS_FS_MAKE_DIR|LANDLOCK_ACCESS_FS_MAKE_REG|LANDLOCK_ACCESS_FS_MAKE_SOCK|LANDLOCK_ACCESS_FS_MAKE_FIFO|LANDLOCK_ACCESS_FS_MAKE_BLOCK|LANDLOCK_ACCESS_FS_MAKE_SYM;
static const uint64_t FS_READ_EXEC = LANDLOCK_ACCESS_FS_EXECUTE|LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_READ_DIR;
static long ll_create(const void *attr,size_t size,uint32_t flags){return syscall(SYS_landlock_create_ruleset,attr,size,flags);} static long ll_add(int fd,int type,const void *attr,uint32_t flags){return syscall(SYS_landlock_add_rule,fd,type,attr,flags);} static long ll_restrict(int fd,uint32_t flags){return syscall(SYS_landlock_restrict_self,fd,flags);}
static int landlock_abi(void){errno=0;long abi=ll_create(NULL,0,LANDLOCK_CREATE_RULESET_VERSION);return abi<0?-1:(int)abi;}
static int add_path_rule(int ruleset_fd,const char *path,uint64_t allowed,int required){int fd=open(path,O_PATH|O_CLOEXEC);if(fd<0){if(!required&&errno==ENOENT)return 0;fprintf(stderr,"SANDBOX_PATH_OPEN_FAILED:%s:%s\n",path,strerror(errno));return -1;}struct landlock_path_beneath_attr rule={.allowed_access=allowed,.parent_fd=fd};int rc=(int)ll_add(ruleset_fd,LANDLOCK_RULE_PATH_BENEATH,&rule,0),saved=errno;close(fd);if(rc<0){fprintf(stderr,"SANDBOX_PATH_RULE_FAILED:%s:%s\n",path,strerror(saved));errno=saved;return -1;}return 0;}
static int apply_landlock(const char *snapshot,const char *tmpdir,const char *node_modules,int allow_loopback_tcp){int abi=landlock_abi();if(abi<4){fprintf(stderr,"SANDBOX_LANDLOCK_ABI_REQUIRED:4:actual=%d\n",abi);return -1;}uint64_t handled_fs=FS_BASE|LANDLOCK_ACCESS_FS_REFER|LANDLOCK_ACCESS_FS_TRUNCATE;struct debugai_ruleset_attr attr={.handled_access_fs=handled_fs,.handled_access_net=allow_loopback_tcp?0:(LANDLOCK_ACCESS_NET_BIND_TCP|LANDLOCK_ACCESS_NET_CONNECT_TCP)};int ruleset_fd=(int)ll_create(&attr,sizeof(attr),0);if(ruleset_fd<0){fprintf(stderr,"SANDBOX_LANDLOCK_CREATE_FAILED:%s\n",strerror(errno));return -1;}const char *readonly[]={"/usr","/usr/local","/bin","/lib","/lib64","/etc"};for(size_t i=0;i<sizeof(readonly)/sizeof(readonly[0]);i++)if(add_path_rule(ruleset_fd,readonly[i],FS_READ_EXEC,0)<0)goto fail;if(add_path_rule(ruleset_fd,"/dev/null",LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_WRITE_FILE,0)<0)goto fail;if(add_path_rule(ruleset_fd,"/dev/urandom",LANDLOCK_ACCESS_FS_READ_FILE,0)<0)goto fail;uint64_t rw=FS_READ_EXEC|LANDLOCK_ACCESS_FS_WRITE_FILE|LANDLOCK_ACCESS_FS_REMOVE_DIR|LANDLOCK_ACCESS_FS_REMOVE_FILE|LANDLOCK_ACCESS_FS_MAKE_DIR|LANDLOCK_ACCESS_FS_MAKE_REG|LANDLOCK_ACCESS_FS_MAKE_SYM|LANDLOCK_ACCESS_FS_REFER|LANDLOCK_ACCESS_FS_TRUNCATE;uint64_t tmp_rw=rw|(allow_loopback_tcp?LANDLOCK_ACCESS_FS_MAKE_SOCK:0);if(add_path_rule(ruleset_fd,snapshot,rw,1)<0)goto fail;if(add_path_rule(ruleset_fd,tmpdir,tmp_rw,1)<0)goto fail;if(node_modules&&node_modules[0]&&add_path_rule(ruleset_fd,node_modules,FS_READ_EXEC,1)<0)goto fail;if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)!=0){fprintf(stderr,"SANDBOX_NO_NEW_PRIVS_FAILED:%s\n",strerror(errno));goto fail;}if(ll_restrict(ruleset_fd,0)!=0){fprintf(stderr,"SANDBOX_LANDLOCK_RESTRICT_FAILED:%s\n",strerror(errno));goto fail;}close(ruleset_fd);return abi;fail:close(ruleset_fd);return -1;}
#define PUSH(stmt) do{if(n>=sizeof(filter)/sizeof(filter[0]))return -1;filter[n++]=(struct sock_filter)stmt;}while(0)
#define DENY_CURRENT() PUSH(BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|(EPERM&SECCOMP_RET_DATA)))
#define ALLOW_CURRENT() PUSH(BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW))
#define DENY_SYSCALL(nr) do{PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,(nr),0,1));DENY_CURRENT();}while(0)
static int install_seccomp(int allow_loopback_tcp){
#if defined(__x86_64__)
const uint32_t expected_arch=AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
const uint32_t expected_arch=AUDIT_ARCH_AARCH64;
#else
#error Unsupported architecture for DebugAI sandbox
#endif
struct sock_filter filter[256];size_t n=0;PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)));PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,expected_arch,1,0));PUSH(BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS));PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)));
#ifdef __NR_socket
if(allow_loopback_tcp){
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_socket,0,20));
PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])));
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AF_UNIX,3,0));
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AF_INET,9,0));
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AF_INET6,8,0));
DENY_CURRENT();
PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[1])));
PUSH(BPF_STMT(BPF_ALU|BPF_AND|BPF_K,SOCK_TYPE_MASK));
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SOCK_STREAM,0,2));
PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[2])));
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,0,0,1));
ALLOW_CURRENT();
DENY_CURRENT();
PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[1])));
PUSH(BPF_STMT(BPF_ALU|BPF_AND|BPF_K,SOCK_TYPE_MASK));
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SOCK_STREAM,0,3));
PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[2])));
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,0,2,0));
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,IPPROTO_TCP,1,0));
DENY_CURRENT();
ALLOW_CURRENT();
}else{DENY_SYSCALL(__NR_socket);}
#endif
#ifdef __NR_socketpair
PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_socketpair,0,10));PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])));PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AF_UNIX,1,0));DENY_CURRENT();PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[1])));PUSH(BPF_STMT(BPF_ALU|BPF_AND|BPF_K,SOCK_TYPE_MASK));PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SOCK_STREAM,1,0));DENY_CURRENT();PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[2])));PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,0,1,0));DENY_CURRENT();PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)));
#endif
#ifdef __NR_ptrace
DENY_SYSCALL(__NR_ptrace);
#endif
#ifdef __NR_process_vm_readv
DENY_SYSCALL(__NR_process_vm_readv);
#endif
#ifdef __NR_process_vm_writev
DENY_SYSCALL(__NR_process_vm_writev);
#endif
#ifdef __NR_kill
if(allow_loopback_tcp){PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_kill,0,4));PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[1])));PUSH(BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,0,1,0));DENY_CURRENT();PUSH(BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)));}else{DENY_SYSCALL(__NR_kill);}
#endif
#ifdef __NR_tkill
DENY_SYSCALL(__NR_tkill);
#endif
#ifdef __NR_tgkill
DENY_SYSCALL(__NR_tgkill);
#endif
#ifdef __NR_pidfd_send_signal
DENY_SYSCALL(__NR_pidfd_send_signal);
#endif
#ifdef __NR_mount
DENY_SYSCALL(__NR_mount);
#endif
#ifdef __NR_umount2
DENY_SYSCALL(__NR_umount2);
#endif
#ifdef __NR_pivot_root
DENY_SYSCALL(__NR_pivot_root);
#endif
#ifdef __NR_chroot
DENY_SYSCALL(__NR_chroot);
#endif
#ifdef __NR_unshare
DENY_SYSCALL(__NR_unshare);
#endif
#ifdef __NR_setns
DENY_SYSCALL(__NR_setns);
#endif
#ifdef __NR_bpf
DENY_SYSCALL(__NR_bpf);
#endif
#ifdef __NR_keyctl
DENY_SYSCALL(__NR_keyctl);
#endif
#ifdef __NR_add_key
DENY_SYSCALL(__NR_add_key);
#endif
#ifdef __NR_request_key
DENY_SYSCALL(__NR_request_key);
#endif
#ifdef __NR_open_by_handle_at
DENY_SYSCALL(__NR_open_by_handle_at);
#endif
#ifdef __NR_perf_event_open
DENY_SYSCALL(__NR_perf_event_open);
#endif
#ifdef __NR_userfaultfd
DENY_SYSCALL(__NR_userfaultfd);
#endif
#ifdef __NR_chmod
DENY_SYSCALL(__NR_chmod);
#endif
#ifdef __NR_fchmod
DENY_SYSCALL(__NR_fchmod);
#endif
#ifdef __NR_fchmodat
DENY_SYSCALL(__NR_fchmodat);
#endif
#ifdef __NR_chown
DENY_SYSCALL(__NR_chown);
#endif
#ifdef __NR_fchown
DENY_SYSCALL(__NR_fchown);
#endif
#ifdef __NR_fchownat
DENY_SYSCALL(__NR_fchownat);
#endif
#ifdef __NR_lchown
DENY_SYSCALL(__NR_lchown);
#endif
#ifdef __NR_setxattr
DENY_SYSCALL(__NR_setxattr);
#endif
#ifdef __NR_lsetxattr
DENY_SYSCALL(__NR_lsetxattr);
#endif
#ifdef __NR_fsetxattr
DENY_SYSCALL(__NR_fsetxattr);
#endif
#ifdef __NR_removexattr
DENY_SYSCALL(__NR_removexattr);
#endif
#ifdef __NR_lremovexattr
DENY_SYSCALL(__NR_lremovexattr);
#endif
#ifdef __NR_fremovexattr
DENY_SYSCALL(__NR_fremovexattr);
#endif
#ifdef __NR_utime
DENY_SYSCALL(__NR_utime);
#endif
#ifdef __NR_utimes
DENY_SYSCALL(__NR_utimes);
#endif
#ifdef __NR_futimesat
DENY_SYSCALL(__NR_futimesat);
#endif
#ifdef __NR_utimensat
DENY_SYSCALL(__NR_utimensat);
#endif
ALLOW_CURRENT();struct sock_fprog prog={.len=(unsigned short)n,.filter=filter};if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)!=0){fprintf(stderr,"SANDBOX_SECCOMP_NNP_FAILED:%s\n",strerror(errno));return -1;}if(prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&prog)!=0){fprintf(stderr,"SANDBOX_SECCOMP_INSTALL_FAILED:%s\n",strerror(errno));return -1;}return 0;}
static void close_extra_fds(void){
#ifdef SYS_close_range
if(syscall(SYS_close_range,3U,~0U,0U)==0)return;
#endif
long maxfd=sysconf(_SC_OPEN_MAX);if(maxfd<0||maxfd>65536)maxfd=65536;for(int fd=3;fd<maxfd;fd++)close(fd);}
static int64_t monotonic_ms(void){struct timespec ts;if(clock_gettime(CLOCK_MONOTONIC,&ts)!=0)return -1;return((int64_t)ts.tv_sec*1000)+(ts.tv_nsec/1000000);}
static void cleanup_process_group(pid_t child){if(child<=0)return;errno=0;if(kill(-child,SIGTERM)!=0&&errno!=ESRCH)fprintf(stderr,"SANDBOX_GROUP_TERM_FAILED:%s\n",strerror(errno));struct timespec pause={.tv_sec=0,.tv_nsec=100*1000*1000};nanosleep(&pause,NULL);errno=0;if(kill(-child,SIGKILL)!=0&&errno!=ESRCH)fprintf(stderr,"SANDBOX_GROUP_KILL_FAILED:%s\n",strerror(errno));}
static int supervise(char **command,long timeout_ms,int allow_loopback_tcp){pid_t child=fork();if(child<0){fprintf(stderr,"SANDBOX_FORK_FAILED:%s\n",strerror(errno));return 69;}if(child==0){(void)setpgid(0,0);if(install_seccomp(allow_loopback_tcp)!=0)_exit(67);close_extra_fds();execvp(command[0],command);fprintf(stderr,"SANDBOX_EXEC_FAILED:%s:%s\n",command[0],strerror(errno));_exit(68);}(void)setpgid(child,child);int64_t started=monotonic_ms();for(;;){int status=0;pid_t r=waitpid(child,&status,WNOHANG);if(r==child){int code=WIFEXITED(status)?WEXITSTATUS(status):WIFSIGNALED(status)?128+WTERMSIG(status):70;cleanup_process_group(child);return code;}if(r<0){fprintf(stderr,"SANDBOX_WAIT_FAILED:%s\n",strerror(errno));cleanup_process_group(child);return 70;}int64_t now=monotonic_ms();if(started<0||now<0||now-started>=timeout_ms){cleanup_process_group(child);(void)waitpid(child,&status,0);fprintf(stderr,"SANDBOX_TIMEOUT:%ld\n",timeout_ms);return 124;}struct timespec pause={.tv_sec=0,.tv_nsec=50*1000*1000};nanosleep(&pause,NULL);}}
static void usage(void){fprintf(stderr,"usage: debugai-sandbox-exec --probe | --snapshot PATH --tmp PATH --timeout-ms N [--node-modules PATH] [--allow-loopback-tcp] -- COMMAND [ARGS...]\n");}
int main(int argc,char **argv){if(argc==2&&strcmp(argv[1],"--probe")==0){int abi=landlock_abi();if(abi<4){fprintf(stderr,"SANDBOX_LANDLOCK_ABI_REQUIRED:4:actual=%d\n",abi);return 2;}printf("LANDLOCK_ABI=%d\nSECCOMP_FILTER=SUPPORTED\nLOOPBACK_TCP_PROFILE=SUPPORTED\n",abi);return 0;}const char *snapshot=NULL,*tmpdir=NULL,*node_modules=NULL;long timeout_ms=0;int allow_loopback_tcp=0,i=1;for(;i<argc;i++){if(strcmp(argv[i],"--")==0){i++;break;}if(strcmp(argv[i],"--snapshot")==0&&i+1<argc){snapshot=argv[++i];continue;}if(strcmp(argv[i],"--tmp")==0&&i+1<argc){tmpdir=argv[++i];continue;}if(strcmp(argv[i],"--node-modules")==0&&i+1<argc){node_modules=argv[++i];continue;}if(strcmp(argv[i],"--allow-loopback-tcp")==0){allow_loopback_tcp=1;continue;}if(strcmp(argv[i],"--timeout-ms")==0&&i+1<argc){char *end=NULL;errno=0;timeout_ms=strtol(argv[++i],&end,10);if(errno||!end||*end||timeout_ms<1000||timeout_ms>300000){fprintf(stderr,"SANDBOX_TIMEOUT_INVALID\n");return 64;}continue;}usage();return 64;}if(!snapshot||!tmpdir||timeout_ms==0||i>=argc){usage();return 64;}if(chdir(snapshot)!=0){fprintf(stderr,"SANDBOX_CHDIR_FAILED:%s\n",strerror(errno));return 65;}int abi=apply_landlock(snapshot,tmpdir,node_modules,allow_loopback_tcp);if(abi<0)return 66;return supervise(&argv[i],timeout_ms,allow_loopback_tcp);}