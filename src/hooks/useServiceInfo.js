import { useEffect } from 'react';
import apiClient from '../api/inseeApiClient';

export default function useServiceInfo({ setServiceInfo, setServiceInfoError }) {
    useEffect(() => {
        let cancelled = false;

        apiClient.getServiceInfo()
            .then((info) => {
                if (!cancelled) {
                    setServiceInfo(info);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setServiceInfoError(err?.message || 'Informations de service indisponibles');
                }
            });

        return () => {
            cancelled = true;
        };
    }, [setServiceInfo, setServiceInfoError]);
}
