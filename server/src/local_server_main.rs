mod codex_app_server;
mod debug_log;
mod local_web_server;
mod transcript;

fn main() {
    if let Err(error) = local_web_server::run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
