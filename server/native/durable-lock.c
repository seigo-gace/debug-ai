#define _GNU_SOURCE

#include <node_api.h>

#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef __linux__
#error DebugAI durable writer locking requires Linux.
#endif

typedef struct {
  int fd;
  pid_t owner_pid;
  dev_t device;
  ino_t inode;
  char *path;
} writer_lock_handle;

static const napi_type_tag WRITER_LOCK_TYPE_TAG = {
  UINT64_C(0x642874a13bc9d520),
  UINT64_C(0xa7d982bd58ef0134)
};

static napi_value throw_code(napi_env env, const char *code) {
  napi_throw_error(env, code, code);
  return NULL;
}

static napi_value boolean_value(napi_env env, bool value) {
  napi_value result;
  if (napi_get_boolean(env, value, &result) != napi_ok) {
    return throw_code(env, "DURABLE_NATIVE_NAPI_FAILED");
  }
  return result;
}

static void destroy_handle(writer_lock_handle *handle) {
  if (handle == NULL) return;
  if (handle->fd >= 0) {
    close(handle->fd);
    handle->fd = -1;
  }
  free(handle->path);
  handle->path = NULL;
  free(handle);
}

static void finalize_handle(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  destroy_handle((writer_lock_handle *)data);
}

static writer_lock_handle *get_handle(napi_env env, napi_value value) {
  napi_valuetype type;
  bool tagged = false;
  writer_lock_handle *handle = NULL;

  if (napi_typeof(env, value, &type) != napi_ok || type != napi_object) {
    throw_code(env, "DURABLE_LOCK_HANDLE_INVALID");
    return NULL;
  }

  if (napi_check_object_type_tag(env, value, &WRITER_LOCK_TYPE_TAG, &tagged) != napi_ok || !tagged) {
    throw_code(env, "DURABLE_LOCK_HANDLE_INVALID");
    return NULL;
  }

  if (napi_unwrap(env, value, (void **)&handle) != napi_ok || handle == NULL) {
    throw_code(env, "DURABLE_LOCK_HANDLE_INVALID");
    return NULL;
  }

  return handle;
}

static bool stat_is_safe_lock(const struct stat *value) {
  return S_ISREG(value->st_mode) && value->st_uid == geteuid() && value->st_nlink == 1 && (value->st_mode & 0077) == 0;
}

static bool handle_file_matches(writer_lock_handle *handle) {
  struct stat opened;
  struct stat named;

  if (fstat(handle->fd, &opened) != 0 || lstat(handle->path, &named) != 0) return false;
  if (!stat_is_safe_lock(&opened) || !stat_is_safe_lock(&named)) return false;

  return opened.st_dev == handle->device && opened.st_ino == handle->inode && named.st_dev == handle->device && named.st_ino == handle->inode;
}

static napi_value acquire_lock(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_valuetype type;
  size_t path_length = 0;
  size_t copied = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1) {
    return throw_code(env, "DURABLE_LOCK_PATH_REQUIRED");
  }

  if (napi_typeof(env, argv[0], &type) != napi_ok || type != napi_string) {
    return throw_code(env, "DURABLE_LOCK_PATH_INVALID");
  }

  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &path_length) != napi_ok || path_length == 0 || path_length > 4096) {
    return throw_code(env, "DURABLE_LOCK_PATH_INVALID");
  }

  char *lock_path = calloc(path_length + 1, 1);
  if (lock_path == NULL) return throw_code(env, "DURABLE_NATIVE_ALLOCATION_FAILED");

  if (napi_get_value_string_utf8(env, argv[0], lock_path, path_length + 1, &copied) != napi_ok || copied != path_length || strlen(lock_path) != path_length || lock_path[0] != '/') {
    free(lock_path);
    return throw_code(env, "DURABLE_LOCK_PATH_INVALID");
  }

  int fd = open(lock_path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) {
    free(lock_path);
    return throw_code(env, "DURABLE_LOCK_OPEN_FAILED");
  }

  struct stat opened;
  struct stat named;
  if (fstat(fd, &opened) != 0 || lstat(lock_path, &named) != 0 || !stat_is_safe_lock(&opened) || !stat_is_safe_lock(&named) || opened.st_dev != named.st_dev || opened.st_ino != named.st_ino) {
    close(fd);
    free(lock_path);
    return throw_code(env, "DURABLE_LOCK_FILE_UNSAFE");
  }

  if (flock(fd, LOCK_EX | LOCK_NB) != 0) {
    const int saved_errno = errno;
    close(fd);
    free(lock_path);
    if (saved_errno == EWOULDBLOCK || saved_errno == EAGAIN) {
      return throw_code(env, "DURABLE_WRITER_BUSY");
    }
    return throw_code(env, "DURABLE_LOCK_ACQUIRE_FAILED");
  }

  writer_lock_handle *handle = calloc(1, sizeof(writer_lock_handle));
  if (handle == NULL) {
    close(fd);
    free(lock_path);
    return throw_code(env, "DURABLE_NATIVE_ALLOCATION_FAILED");
  }

  handle->fd = fd;
  handle->owner_pid = getpid();
  handle->device = opened.st_dev;
  handle->inode = opened.st_ino;
  handle->path = lock_path;

  if (!handle_file_matches(handle)) {
    destroy_handle(handle);
    return throw_code(env, "DURABLE_LOCK_FILE_CHANGED");
  }

  napi_value result;
  if (napi_create_object(env, &result) != napi_ok || napi_type_tag_object(env, result, &WRITER_LOCK_TYPE_TAG) != napi_ok) {
    destroy_handle(handle);
    return throw_code(env, "DURABLE_NATIVE_NAPI_FAILED");
  }

  if (napi_wrap(env, result, handle, finalize_handle, NULL, NULL) != napi_ok) {
    destroy_handle(handle);
    return throw_code(env, "DURABLE_NATIVE_NAPI_FAILED");
  }

  return result;
}

static napi_value assert_lock_held(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1) {
    return throw_code(env, "DURABLE_LOCK_HANDLE_INVALID");
  }

  writer_lock_handle *handle = get_handle(env, argv[0]);
  if (handle == NULL) return NULL;
  if (handle->fd < 0) return throw_code(env, "DURABLE_LOCK_CLOSED");
  if (handle->owner_pid != getpid()) return throw_code(env, "DURABLE_LOCK_PROCESS_MISMATCH");

  const int descriptor_flags = fcntl(handle->fd, F_GETFD);
  if (descriptor_flags < 0 || (descriptor_flags & FD_CLOEXEC) == 0) {
    return throw_code(env, "DURABLE_LOCK_DESCRIPTOR_UNSAFE");
  }

  if (!handle_file_matches(handle)) return throw_code(env, "DURABLE_LOCK_FILE_CHANGED");
  if (flock(handle->fd, LOCK_EX | LOCK_NB) != 0) return throw_code(env, "DURABLE_LOCK_NOT_HELD");
  return boolean_value(env, true);
}

static napi_value release_lock(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1) {
    return throw_code(env, "DURABLE_LOCK_HANDLE_INVALID");
  }

  writer_lock_handle *handle = get_handle(env, argv[0]);
  if (handle == NULL) return NULL;
  if (handle->owner_pid != getpid()) return throw_code(env, "DURABLE_LOCK_PROCESS_MISMATCH");
  if (handle->fd < 0) return boolean_value(env, false);

  const int fd = handle->fd;
  handle->fd = -1;
  if (close(fd) != 0) return throw_code(env, "DURABLE_LOCK_CLOSE_FAILED");
  return boolean_value(env, true);
}

static napi_value initialize(napi_env env, napi_value exports) {
  const napi_property_descriptor properties[] = {
    { "acquire", NULL, acquire_lock, NULL, NULL, NULL, napi_default, NULL },
    { "assertHeld", NULL, assert_lock_held, NULL, NULL, NULL, napi_default, NULL },
    { "release", NULL, release_lock, NULL, NULL, NULL, napi_default, NULL }
  };

  if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties) != napi_ok) {
    return throw_code(env, "DURABLE_NATIVE_NAPI_FAILED");
  }
  return exports;
}

NAPI_MODULE(debugai_durable_lock, initialize)
