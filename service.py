from time import perf_counter

import psutil, platform


def collect_system_stats():
    start_time = perf_counter()
    disk_before = psutil.disk_io_counters()
    net_before = psutil.net_io_counters()

    cpu_percent = psutil.cpu_percent(interval=1)

    disk_after = psutil.disk_io_counters()
    net_after = psutil.net_io_counters()
    elapsed_time = perf_counter() - start_time

    system_version = platform.platform()

    memory = psutil.virtual_memory()
    memory_total = memory.total
    memory_used = memory.used
    memory_percent = memory.percent

    disk_read_speed = calculate_rate(disk_before, disk_after, "read_bytes", elapsed_time)
    disk_write_speed = calculate_rate(disk_before, disk_after, "write_bytes", elapsed_time)
    net_read_speed = calculate_rate(net_before, net_after, "bytes_recv", elapsed_time)
    net_write_speed = calculate_rate(net_before, net_after, "bytes_sent", elapsed_time)

    return make_up_stats(
        system_version,
        cpu_percent,
        memory_total,
        memory_used,
        memory_percent,
        disk_read_speed,
        disk_write_speed,
        net_read_speed,
        net_write_speed)


def calculate_rate(before, after, field, elapsed_time):
    if before is None or after is None or elapsed_time is None:
        return None
    difference = getattr(after, field) - getattr(before, field)

    if difference <= 0:
        return None

    return difference / elapsed_time


def make_up_stats(
        system_version,
        cpu_percent,
        memory_total,
        memory_used,
        memory_percent,
        disk_read_speed,
        disk_write_speed,
        net_read_speed,
        net_write_speed, ):
    result = {
        "system": {
            "version": system_version
        },
        "cpu": {
            "percent": cpu_percent
        },
        "memory": {
            "total": memory_total,
            "used": memory_used,
            "percent": memory_percent,
        },
        "disk": {
            "read_speed": disk_read_speed,
            "write_speed": disk_write_speed,
        },
        "net": {
            "read_speed": net_read_speed,
            "write_speed": net_write_speed,
        }}

    return result


if __name__ == "__main__":
    print(collect_system_stats())
