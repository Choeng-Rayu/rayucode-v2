use super::*;

/// Centralizes runtime lookup and lifecycle decisions for provider slots that
/// can have more than one concrete runtime behind a single public provider.
///
/// Today the main case is `ActiveProvider::OpenRouter`: real OpenRouter and
/// direct OpenAI-compatible profiles share the OpenAI-compatible wire protocol,
/// but they are distinct runtime identities and must not overwrite each other.
pub(super) struct ProviderRegistry<'a> {
    provider: &'a MultiProvider,
}

impl<'a> ProviderRegistry<'a> {
    pub(super) fn new(provider: &'a MultiProvider) -> Self {
        Self { provider }
    }

    pub(super) fn real_openrouter(&self) -> Option<Arc<dyn Provider>> {
        self.provider
            .openrouter
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub(super) fn compatible_profile(&self, profile_id: &str) -> Option<Arc<dyn Provider>> {
        self.provider
            .openai_compatible_profiles
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(profile_id)
            .cloned()
    }

    pub(super) fn install_compatible_profile(
        &self,
        profile_id: impl Into<String>,
        runtime: Arc<dyn Provider>,
    ) {
        self.provider
            .openai_compatible_profiles
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(profile_id.into(), runtime);
    }

    pub(super) fn remove_compatible_profile(&self, profile_id: &str) {
        self.provider
            .openai_compatible_profiles
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(profile_id);
        let mut active = self
            .provider
            .active_openai_compatible_profile
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if active.as_deref() == Some(profile_id) {
            *active = None;
        }
    }

    pub(super) fn fork_compatible_profiles(&self) -> HashMap<String, Arc<dyn Provider>> {
        self.provider
            .openai_compatible_profiles
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .map(|(id, runtime)| (id.clone(), runtime.fork()))
            .collect()
    }

    pub(super) fn active_compatible_profile_id(&self) -> Option<String> {
        self.provider
            .active_openai_compatible_profile
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub(super) fn set_active_compatible_profile(&self, profile_id: impl Into<String>) {
        *self
            .provider
            .active_openai_compatible_profile
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(profile_id.into());
    }

    pub(super) fn clear_active_compatible_profile(&self) {
        *self
            .provider
            .active_openai_compatible_profile
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }

    pub(super) fn active_compatible_profile(&self) -> Option<Arc<dyn Provider>> {
        let profile_id = self.active_compatible_profile_id()?;
        self.compatible_profile(&profile_id)
    }

    /// Runtime that should execute requests for the public OpenRouter slot.
    pub(super) fn active_openrouter_execution(&self) -> Option<Arc<dyn Provider>> {
        self.active_compatible_profile()
            .or_else(|| self.real_openrouter())
    }
}
